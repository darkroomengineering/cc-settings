// Fresh load with hook.js injected (scene/renderer/pass capture + virtual clock).
// usage: node cdp.js boot.js <url> [gateX,gateY] [settleSeconds=9]
// env COOKIES="k=v; k2=v2" sets cookies first (lock a random theme, skip a consent banner or an intro).
// env TIMERS=1 also puts setTimeout/setInterval on the virtual clock (games, app flows, countdowns: see timers.js).
// env BLOCK / FAKE_OK keep the capture from writing to production (scores, leads, analytics: see netguard.js).
// gate = where to click a "click to enter / enable sound" gate, if the site has one. Reload between captures so toggled state never leaks.
const fs = require('node:fs'), netguard = require('./netguard.js')
// Headless Chrome's content area is smaller than --window-size (1920x993), and a viewport override dies with the CDP session that set it,
// so later tasks would shoot 1920x993. Size the window itself so the page is 1920x1080 for every session.
const fitWindow = async (page) => {
  const s = await page.createCDPSession(), { windowId } = await s.send('Browser.getWindowForTarget')
  const [w, h] = await page.evaluate(() => [outerWidth - innerWidth, outerHeight - innerHeight])
  await s.send('Browser.setWindowBounds', { windowId, bounds: { width: 1920 + w, height: 1080 + h } }).catch(() => {})
}
const inject = async (page) => {
  await page.evaluateOnNewDocument(fs.readFileSync(__dirname + '/hook.js', 'utf8'))
  if (process.env.TIMERS) await page.evaluateOnNewDocument(fs.readFileSync(__dirname + '/timers.js', 'utf8'))
  if (process.env.BLOCK || process.env.FAKE_OK) await page.evaluateOnNewDocument(netguard.init, process.env.BLOCK || '', process.env.FAKE_OK || '')
}
module.exports = async (page, url, gate = '', settle = '9') => {
  await fitWindow(page)
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await inject(page)
  if (process.env.COOKIES) {
    const host = new URL(url).hostname
    await page.setCookie(...process.env.COOKIES.split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const [name, ...v] = c.split('='); return { name, value: v.join('='), domain: host, path: '/' } }))
  }
  await page.goto(url, { waitUntil: 'load', timeout: 120000 })
  await new Promise((r) => setTimeout(r, 6000))
  if (gate) { const [x, y] = gate.split(',').map(Number); await page.mouse.click(x, y) }
  await new Promise((r) => setTimeout(r, +settle * 1000))
  return page.evaluate(() => {
    window.__big = __cap.scenes.filter((s) => s.children.length > 2)
    const effs = __cap.passes.flatMap((p) => (p.effects ? p.effects : p.isPass ? [p] : []))
    window.__orig = { opac: new Map(effs.map((e) => [e, e.blendMode ? e.blendMode.opacity.value : e.enabled])) }
    return { scenes: __cap.scenes.length, bigScenes: __big.map((s) => s.children.length), renderers: __cap.renderers.length, effects: [...new Set(effs.map((e) => e.name || e.constructor?.name))], webgl: __cap.renderers.length > 0, scrollHeight: document.documentElement.scrollHeight }
  })
}
module.exports.fitWindow = fitWindow
module.exports.inject = inject
