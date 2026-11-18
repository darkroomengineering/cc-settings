// Fake data layer: every capture of a project with private data (customer names, amounts, emails, avatars) shows fake but convincing
// values instead. It rewrites the responses before the page sees them, so server-rendered HTML, API JSON and scripts all carry the fake
// values, every take shows the same fake person, and no frame can leak a real value the way a blur can.
// usage (run_in_background, keep it running for every take, start it before boot.js): node fakedata.js <map.json>
// map.json (sensitive: it lists the real values; keep it in <WORK>, never in _toolkit/, Drive or the board):
//   { "text": { "<real>": "<fake>", … },                  exact strings, longest first; keep each fake the same length and format
//     "patterns": [{ "match": "<regex>", "replace": "<string>" }, …],   e.g. every email on the client's domain
//     "images": { "<url glob>": "<local image file>", … } } avatars, logos, photos of people
// Limits: it only replaces values the map lists, in the form the response sends them (a raw number the page formats itself passes).
// WebSocket, WebRTC and server-sent event streams pass through unchanged, and data the app already cached (IndexedDB, a service worker)
// never reaches the network: capture with a fresh Chrome profile and check every take with leakcheck.js. Not yet tested: cross-origin
// iframes, web workers, the first request of a tab opened during a take, and running beside origin-swap.js.
const fs = require('node:fs'), path = require('node:path')
const puppeteer = require(require.resolve('puppeteer-core', { paths: [__dirname, process.cwd()] }))
const mapFile = process.argv[2]
if (!mapFile) { console.error('usage: node fakedata.js <map.json>'); process.exit(1) }
const map = JSON.parse(fs.readFileSync(mapFile, 'utf8'))
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const pairs = Object.entries(map.text || {}).sort((a, b) => b[0].length - a[0].length)
const rules = [
  ...(pairs.length ? [{ re: new RegExp(pairs.map(([r]) => esc(r)).join('|'), 'g'), to: (m) => map.text[m] }] : []),
  ...(map.patterns || []).map((p) => ({ re: new RegExp(p.match, 'g'), to: () => p.replace })),
]
const images = Object.entries(map.images || {}).map(([glob, file]) => ({ glob, file: path.resolve(path.dirname(mapFile), file) }))
for (const i of images) if (!fs.existsSync(i.file)) { console.error(`fakedata: image ${i.file} does not exist`); process.exit(1) }
const MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.gif': 'image/gif', '.avif': 'image/avif' }
const globRe = (g) => new RegExp(`^${g.split('*').map(esc).join('.*')}$`)
const TEXT = /^(text\/|application\/(json|javascript|x-javascript|xml|xhtml\+xml|ld\+json|x-component|graphql-response\+json))|\+json/i
const counts = new Map()
const swap = (body, url) => {
  let n = 0
  for (const r of rules) body = body.replace(r.re, (m) => { n++; return r.to(m) })
  if (n) counts.set(url, (counts.get(url) || 0) + n)
  return [body, n]
}

async function attach(target) {
  if (target.type() !== 'page') return
  const s = await target.createCDPSession()
  s.on('Fetch.requestPaused', async (e) => {
    try {
      const img = images.find((i) => globRe(i.glob).test(e.request.url))
      if (img) {
        const ext = path.extname(img.file).toLowerCase()
        return await s.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: 200, body: fs.readFileSync(img.file).toString('base64'),
          responseHeaders: [{ name: 'Content-Type', value: MIME[ext] || 'application/octet-stream' }, { name: 'Access-Control-Allow-Origin', value: '*' }, { name: 'Cache-Control', value: 'no-store' }] })
      }
      if (e.responseStatusCode === undefined || e.responseErrorReason) return await s.send('Fetch.continueRequest', { requestId: e.requestId })
      const type = (e.responseHeaders || []).find((h) => /^content-type$/i.test(h.name))?.value || ''
      if (!TEXT.test(type) || (e.responseStatusCode >= 300 && e.responseStatusCode < 400)) return await s.send('Fetch.continueResponse', { requestId: e.requestId })
      const r = await s.send('Fetch.getResponseBody', { requestId: e.requestId })
      const [body, n] = swap(r.base64Encoded ? Buffer.from(r.body, 'base64').toString('utf8') : r.body, e.request.url)
      if (!n) return await s.send('Fetch.continueResponse', { requestId: e.requestId })
      // the body is re-sent decoded, so drop the headers that describe the original bytes
      const headers = e.responseHeaders.filter((h) => !/^(content-length|content-encoding|etag|content-security-policy)$/i.test(h.name))
      await s.send('Fetch.fulfillRequest', { requestId: e.requestId, responseCode: e.responseStatusCode, responseHeaders: headers, body: Buffer.from(body, 'utf8').toString('base64') })
    } catch (err) {
      // never let a failed rewrite through as real data: fail the request, and say so
      console.error(`fakedata: could not rewrite ${e.request.url}: ${err.message}; the request was failed, not passed through`)
      await s.send('Fetch.failRequest', { requestId: e.requestId, errorReason: 'Failed' }).catch(() => {})
    }
  })
  await s.send('Network.enable').catch(() => {})
  await s.send('Network.setBypassServiceWorker', { bypass: true }).catch(() => {})
  await s.send('Network.setCacheDisabled', { cacheDisabled: true }).catch(() => {})
  await s.send('Fetch.enable', { patterns: [
    ...images.map((i) => ({ urlPattern: i.glob, requestStage: 'Request' })),
    ...['Document', 'XHR', 'Fetch', 'Script', 'Other'].map((resourceType) => ({ urlPattern: '*', resourceType, requestStage: 'Response' })),
  ] })
  console.log('fakedata attached to', target.url() || '(new page)')
}

;(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://127.0.0.1:9333', defaultViewport: null })
  for (const t of browser.targets()) await attach(t)
  browser.on('targetcreated', attach)
  setInterval(() => { if (counts.size) { console.log('fakedata replacements:', JSON.stringify(Object.fromEntries(counts))); counts.clear() } }, 5000)
  console.log(`fakedata: ${pairs.length} values, ${(map.patterns || []).length} patterns, ${images.length} images (Ctrl-C / kill to stop)`)
  await new Promise(() => {}) // stay connected: interception lives as long as this session
})().catch((e) => { console.error(e); process.exit(1) })
