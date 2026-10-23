// Capture a local build whose CDN only serves the production origin (Sanity, Cloudinary, imgix… return 403 / no CORS for localhost).
// For requests matching a URL pattern, presents the production origin to the CDN and hands the local page a matching CORS header.
// Only touches this capture browser; the project and its CDN settings stay as they are.
// usage (run_in_background, keep it running while you capture): node origin-swap.js <url glob, e.g. "*cdn.sanity.io*"> <production origin>
const puppeteer = require(require.resolve('puppeteer-core', { paths: [__dirname, process.cwd()] }))
const [pattern, prodOrigin] = process.argv.slice(2)
if (!pattern || !prodOrigin) { console.error('usage: node origin-swap.js "<url glob>" <https://production.origin>'); process.exit(1) }

async function attach(target) {
  if (target.type() !== 'page') return
  const s = await target.createCDPSession()
  let pageOrigin = ''
  s.on('Fetch.requestPaused', async (e) => {
    try {
      if (e.responseStatusCode === undefined && !e.responseErrorReason) {
        // request stage: swap the Origin the CDN sees
        try { pageOrigin = new URL(target.url()).origin } catch {}
        const headers = Object.entries(e.request.headers).filter(([k]) => k.toLowerCase() !== 'origin').map(([name, value]) => ({ name, value }))
        headers.push({ name: 'Origin', value: prodOrigin })
        await s.send('Fetch.continueRequest', { requestId: e.requestId, headers, interceptResponse: true })
      } else {
        // response stage: allow the page's real origin
        const h = (e.responseHeaders || []).filter((x) => !/^access-control-allow-origin$/i.test(x.name))
        h.push({ name: 'Access-Control-Allow-Origin', value: pageOrigin || '*' })
        await s.send('Fetch.continueResponse', { requestId: e.requestId, responseCode: e.responseStatusCode, responseHeaders: h })
      }
    } catch (err) {
      await s.send('Fetch.continueRequest', { requestId: e.requestId }).catch(() => {})
    }
  })
  await s.send('Fetch.enable', { patterns: [{ urlPattern: pattern, requestStage: 'Request' }] })
  console.log('origin-swap attached to', target.url() || '(new page)')
}

;(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://127.0.0.1:9333', defaultViewport: null })
  for (const t of browser.targets()) await attach(t)
  browser.on('targetcreated', attach)
  console.log(`origin-swap: ${pattern} -> Origin ${prodOrigin} (Ctrl-C / kill to stop)`)
  await new Promise(() => {}) // stay connected: interception lives as long as this session
})().catch((e) => { console.error(e); process.exit(1) })
