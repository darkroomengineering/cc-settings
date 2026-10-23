// In-browser turntable: spins one live object a full turn with the site's own shaders and lights, interface hidden. Use it when a 3D
// subject has no model file (procedural geometry, runtime instancing, shader-drawn surfaces) or when Blender can't match the look.
// usage: OUT=dir node cdp.js spin.js "<target pred: (o) => bool>" [seconds=8] [axis=y]
//   e.g. "(o) => !!o.material?.uniforms?.uInstanceData"   (eased in and out; the object's own rotation is restored afterwards)
const { rec } = require('./rec.js')
module.exports = async (page, pred, secs = '8', axis = 'y') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.evaluate(`(() => {
    let t; __cap.scenes.forEach((s) => s.traverse((o) => { if (!t && (${pred})(o)) t = o }))
    if (!t) throw new Error('spin.js: nothing matches the target predicate')
    window.__SP = { o: t, r: t.rotation.clone() }
    const hide = (e) => { e.dataset.spHide = e.style.visibility; e.style.visibility = 'hidden' }
    document.querySelectorAll('body > *').forEach((e) => { if (!e.querySelector('canvas') && e.tagName !== 'CANVAS') hide(e) })
    document.querySelectorAll('header, nav, main, button, a, [role=dialog]').forEach((e) => !e.querySelector('canvas') && hide(e))
  })()`)
  const frames = Math.round(+secs * 60)
  await rec(page, { dir: process.env.OUT, frames, perFrame: (i) => `{ const k = ${i / (frames - 1)}, e = k < .5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2; __SP.o.rotation.${axis} = __SP.r.${axis} + e * Math.PI * 2 }` })
  await page.evaluate(() => { __SP.o.rotation.copy(__SP.r); document.querySelectorAll('[data-sp-hide]').forEach((e) => { e.style.visibility = e.dataset.spHide; delete e.dataset.spHide }) })
  return { frames }
}
