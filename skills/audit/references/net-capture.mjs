// Cold-load network capture under emulated mobile network + CPU throttling.
// Records every request the page makes up to `load` (+3 s for LCP) and prints
// a JSON summary plus the request timeline. Uses Playwright's bundled
// Chromium through CDP, so it works headless with no system Chrome.
//
//   node net-capture.mjs <url> [slow3g|3g|4g|none] [mobile|desktop]
//   BLOCK='\.woff2$' node net-capture.mjs <url> slow3g    # abort matching URLs
//
// Profiles mirror Chrome DevTools presets: `slow3g` is DevTools "3G"
// (400 kbps, 400 ms RTT here; DevTools uses 2 s), `3g` is DevTools "Slow 4G"
// (1.6 Mbps, 150 ms), `4g` is "Fast 4G". CPU is throttled 4x on every profile
// to approximate a mid-range phone. Run at least 3 times and report the
// median; compare only numbers from the same machine and the same host.
//
// `BLOCK` is the experiment knob: block a resource class at the network layer
// and re-measure to learn what first paint actually waits on, without
// touching the code.
import { chromium, devices } from '@playwright/test'

const url = process.argv[2]
if (!url) {
  console.error('usage: node net-capture.mjs <url> [slow3g|3g|4g|none] [mobile|desktop]')
  process.exit(2)
}
const profile = process.argv[3] ?? '3g'
const NET = {
  slow3g: { downloadThroughput: 400e3 / 8, uploadThroughput: 400e3 / 8, latency: 400 },
  '3g': { downloadThroughput: 1.6e6 / 8, uploadThroughput: 750e3 / 8, latency: 150 },
  '4g': { downloadThroughput: 9e6 / 8, uploadThroughput: 1.5e6 / 8, latency: 40 },
  none: null,
}[profile]
if (NET === undefined) {
  console.error(`unknown profile ${profile}`)
  process.exit(2)
}
const origin = new URL(url).origin

const browser = await chromium.launch()
const ctx = await browser.newContext(
  process.argv[4] === 'desktop'
    ? { viewport: { width: 1440, height: 900 } }
    : { ...devices['Pixel 7'] }
)
const page = await ctx.newPage()
const cdp = await ctx.newCDPSession(page)
await cdp.send('Network.enable')
if (NET) await cdp.send('Network.emulateNetworkConditions', { offline: false, ...NET })
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })

const reqs = new Map()
cdp.on('Network.requestWillBeSent', (e) =>
  reqs.set(e.requestId, { url: e.request.url, type: e.type, start: e.timestamp })
)
cdp.on('Network.responseReceived', (e) => {
  const r = reqs.get(e.requestId)
  if (r) {
    r.status = e.response.status
    r.protocol = e.response.protocol
  }
})
cdp.on('Network.loadingFinished', (e) => {
  const r = reqs.get(e.requestId)
  if (r) {
    r.bytes = e.encodedDataLength
    r.end = e.timestamp
  }
})
if (process.env.BLOCK) await page.route(new RegExp(process.env.BLOCK), (r) => r.abort())

await page.goto(url, { waitUntil: 'load', timeout: 120_000 })
const nav = await page.evaluate(() => {
  const n = performance.getEntriesByType('navigation')[0]
  return {
    ttfb: n.responseStart,
    fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? 0,
    dcl: n.domContentLoadedEventEnd,
    load: n.loadEventEnd,
  }
})
await page.waitForTimeout(3000)
const lcp = await page.evaluate(
  () =>
    new Promise((res) => {
      let v = 0
      new PerformanceObserver((l) => {
        for (const e of l.getEntries()) v = e.startTime
      }).observe({ type: 'largest-contentful-paint', buffered: true })
      setTimeout(() => res(v), 500)
    })
)

const list = [...reqs.values()].filter((r) => r.bytes !== undefined)
const t0 = Math.min(...list.map((r) => r.start))
const total = list.reduce((a, r) => a + (r.bytes || 0), 0)
const byType = {}
for (const r of list) {
  byType[r.type] ??= { n: 0, bytes: 0 }
  byType[r.type].n++
  byType[r.type].bytes += r.bytes || 0
}
console.log(
  JSON.stringify(
    {
      url,
      profile,
      requests: list.length,
      totalKB: +(total / 1024).toFixed(1),
      nav: Object.fromEntries(
        Object.entries({ ...nav, lcp }).map(([k, v]) => [k, Math.round(v)])
      ),
      byType,
    },
    null,
    1
  )
)
console.log('--- requests (start ms, end ms, KB, type, url)')
for (const r of list.sort((a, b) => a.start - b.start)) {
  const ms = (t) => Math.round((t - t0) * 1000).toString().padStart(6)
  console.log(
    `${ms(r.start)} ${ms(r.end)} ${((r.bytes || 0) / 1024).toFixed(1).padStart(7)}  ${(r.type || '').padEnd(10)} ${r.url.replace(origin, '')}`
  )
}
await browser.close()
