// Titles alone on black: pin the transition effect's scene inputs to a 1x1 black texture (the site rewrites them every scroll,
// so a getter wins), hide lens effects and the DOM, then scroll through a title reveal; optional scripted cursor pass for pointer-reactive type.
// usage: OUT=dir node cdp.js <this file> <y0> <y1> [seconds=5] [hoverSeconds=4]
const { prelude } = require('../scripts/browser/prelude.js'), { rec } = require('../scripts/browser/rec.js')
const EFFECT = 'TransitionEffect', INPUTS = ['uTextureA', 'uTextureB'], LENS = /Chromatic|Vignette|Noise|Bloom/
module.exports = async (page, y0, y1, secs = '5', hoverSecs = '4') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.evaluate(prelude)
  await page.evaluate(({ y, name, inputs, lens }) => {
    scrollTo(0, +y); __H.ui(0); __H.fx(new RegExp(lens), 0)
    const e = __H.effs.find((e) => e.name === name), tex = e.uniforms.get(inputs[0]).value
    const black = new tex.constructor(); black.image = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }); black.needsUpdate = true
    window.__pin = inputs.map((k) => { const u = e.uniforms.get(k); Object.defineProperty(u, 'value', { get: () => black, set() {}, configurable: true }); return u })
  }, { y: y0, name: EFFECT, inputs: INPUTS, lens: LENS.source })
  await new Promise((r) => setTimeout(r, 2500))
  const f = Math.round(+secs * 60)
  await rec(page, { dir: process.env.OUT + '/type_reveal', frames: f, perFrame: (i) => `scrollTo(0, ${+y0 + (+y1 - +y0) * (i / (f - 1))})` })
  const h = Math.round(+hoverSecs * 60)
  if (h) await rec(page, { dir: process.env.OUT + '/type_hover', frames: h, perFrame: (i) => {
    const u = i / (h - 1), x = 300 + 1300 * u, yy = 330 + 90 * Math.sin(u * Math.PI * 2) // a hand-like S through the title
    return `window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x}, clientY: ${yy}, bubbles: true }))`
  } })
  await page.evaluate((lens) => { __pin.forEach((u) => delete u.value); __H.fx(new RegExp(lens), 1); __H.ui(1) }, LENS.source)
  return 'ok'
}
