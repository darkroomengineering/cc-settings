// Titles alone on black, then a scroll through a title reveal, plus an optional scripted cursor pass for pointer-reactive type.
// Two strategies:
//  - EFFECT set: the site blends scene render targets in a full-screen effect -> pin that effect's input textures to 1x1 black
//    (the site rewrites them every scroll, so a getter wins) and the text, composited later, stays.
//  - EFFECT = '': hide every mesh that is not text (troika Text has a string .text; SDF text materials carry uTroika* uniforms) and clear backgrounds.
// DOM-rendered titles need neither: use layers.js in DOM mode, css() everything but the title off.
// usage: OUT=dir node cdp.js <this file> <y0> <y1> [seconds=5] [hoverSeconds=4]
const { prelude } = require('../scripts/browser/prelude.js'), { rec } = require('../scripts/browser/rec.js')
const { goTo } = require('../scripts/browser/goto.js')
const EFFECT = '' // blend-shader strategy only: the effect's name from map.js; '' = hide-non-text-meshes strategy
const INPUTS = ['uFILL_ME', 'uFILL_ME'] // blend-shader strategy only: the effect's sampler uniforms holding the scene render targets
const LENS = /Bloom|Chromatic|Vignette|Noise|Grain|Film/
module.exports = async (page, y0, y1, secs = '5', hoverSecs = '4') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y0)
  await page.evaluate(prelude)
  await page.evaluate(({ y, name, inputs, lens }) => {
    __H.ui(0); __H.fx(new RegExp(lens), 0)
    window.__pin = []; window.__hid = []
    if (name) {
      const e = __H.effs.find((e) => e.name === name), tex = e.uniforms.get(inputs[0]).value
      const black = new tex.constructor(); black.image = Object.assign(document.createElement('canvas'), { width: 1, height: 1 }); black.needsUpdate = true
      __pin = inputs.map((k) => { const u = e.uniforms.get(k); Object.defineProperty(u, 'value', { get: () => black, set() {}, configurable: true }); return u })
    } else {
      const isText = (o) => typeof o.text === 'string' || Object.keys(o.material?.uniforms || {}).some((k) => k.startsWith('uTroika'))
      __big.forEach((sc) => { __hid.push([sc, 'background', sc.background]); sc.background = null
        sc.traverse((o) => { if (o.isMesh && !isText(o) && o.visible) { __hid.push([o, 'visible', true]); o.visible = false } }) })
    }
  }, { y: y0, name: EFFECT, inputs: INPUTS, lens: LENS.source })
  await new Promise((r) => setTimeout(r, 2500))
  const f = Math.round(+secs * 60)
  await rec(page, { dir: process.env.OUT + '/type_reveal', frames: f, perFrame: (i) => `scrollTo(0, ${+y0 + (+y1 - +y0) * (i / (f - 1))})` })
  const h = Math.round(+hoverSecs * 60)
  if (h) await rec(page, { dir: process.env.OUT + '/type_hover', frames: h, perFrame: (i) => {
    const u = i / (h - 1), x = 300 + 1300 * u, yy = 330 + 90 * Math.sin(u * Math.PI * 2) // a hand-like S through the title
    return `window.dispatchEvent(new PointerEvent('pointermove', { clientX: ${x}, clientY: ${yy}, bubbles: true }))`
  } })
  await page.evaluate((lens) => { __pin.forEach((u) => delete u.value); __hid.forEach(([o, k, v]) => (o[k] = v)); __H.fx(new RegExp(lens), 1); __H.ui(1) }, LENS.source)
  return 'ok'
}
