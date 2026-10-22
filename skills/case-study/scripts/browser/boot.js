// Fresh load with hook.js injected (scene/renderer/pass capture + virtual clock).
// usage: node cdp.js boot.js <url> [gateX,gateY] [settleSeconds=9]
// gate = where to click a "click to enter / enable sound" gate, if the site has one. Reload between captures so toggled state never leaks.
const fs = require('node:fs')
module.exports = async (page, url, gate = '', settle = '9') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.evaluateOnNewDocument(fs.readFileSync(__dirname + '/hook.js', 'utf8'))
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
