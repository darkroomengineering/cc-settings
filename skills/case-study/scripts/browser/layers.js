// Decompose one chapter: apply a recipe's steps one by one -> stills (NN_label.png) + a live build video (frames, one step every `per` s).
// usage: OUT=dir node cdp.js layers.js <recipes.js> <setName> [per=1.25]
// recipes.js exports { setName: { y, scene: '(s, has, cnt) => bool', steps: [[label, code], ...] } }. Omit `scene` for DOM-only sites
// (GSAP / Lottie / CSS / video layers): steps then use css(selector, on), ui(on) and fx; s/k are null.
// Step code runs with: s (scene), k (children), cnt, has, inst (instanced meshes inside originally-visible groups),
// O (original background/fog/visibility), only(f) (hide all but camera + matches), show(f), uni(f) (uniforms of matches), fx(re,on), ui(on), css(sel,on).
// Nested scenes (R3F often wraps meshes 5+ groups deep): onlyDeep(f) / showDeep(f) act on every renderable (mesh, points, line, sprite, light)
// at any depth and leave groups alone; restoreDeep() puts every descendant back to its shipped visibility.
const path = require('node:path'), fs = require('node:fs')
const { prelude } = require('./prelude.js'), { rec } = require('./rec.js')
const { goTo } = require('./goto.js')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
module.exports = async (page, recipesPath, name, per = '1.25') => {
  const c = require(path.resolve(recipesPath))[name], dir = `${process.env.OUT}/${name}`
  fs.mkdirSync(`${dir}/stills`, { recursive: true })
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, c.y, { settle: 3000 })
  await page.evaluate(prelude)
  const info = await page.evaluate(c.scene ? `(() => {
    const { has, cnt } = __H, s = __H.pick(${c.scene}); if (!s) throw new Error('no scene matches the recipe predicate (lazy chapter not loaded yet? wrong y?)'); const k = s.children
    const inst = []; s.traverse((m) => m.isInstancedMesh && inst.push(m))
    const O = { bg: s.background, fog: s.fog, vis: k.map((o) => o.visible) }
    const only = (f) => k.forEach((o) => (o.visible = o.isCamera || !!f(o)))
    const show = (f) => k.forEach((o) => f(o) && (o.visible = true))
    const uni = (f) => { const r = []; s.traverse((o) => f(o) && o.material?.uniforms && r.push(o.material.uniforms)); return r }
    const leaf = (o) => o.isMesh || o.isPoints || o.isLine || o.isSprite || o.isLight
    const deep = new Map(); s.traverse((o) => deep.set(o, o.visible))
    const onlyDeep = (f) => s.traverse((o) => leaf(o) && (o.visible = deep.get(o) && !!f(o)))
    const showDeep = (f) => s.traverse((o) => leaf(o) && f(o) && deep.get(o) && (o.visible = true))
    const restoreDeep = () => s.traverse((o) => deep.has(o) && (o.visible = deep.get(o)))
    window.__C = { s, k, cnt, has, inst, O, only, show, uni, onlyDeep, showDeep, restoreDeep, fx: __H.fx, ui: __H.ui, css: __H.css }
    return { children: k.length, instanced: inst.map((m) => cnt(m) + '×' + m.count) }
  })()` : `(() => { window.__C = { s: null, k: null, fx: __H.fx, ui: __H.ui, css: __H.css }; return { mode: 'dom' } })()`)
  const slug = (l) => l.toLowerCase().replace(/\W+/g, '_').replace(/^_|_$/g, '')
  for (const [i, [label, code]] of c.steps.entries()) {
    await page.evaluate(`with(__C){${code}}`); await wait(900)
    await page.screenshot({ path: `${dir}/stills/${String(i + 1).padStart(2, '0')}_${slug(label)}.png` })
  }
  const n = Math.round(+per * 60)
  await rec(page, { dir: `${dir}/build`, frames: n * c.steps.length + 90, perFrame: (i) => (i % n === 0 && i / n < c.steps.length ? `with(__C){${c.steps[i / n][1]}}` : '0') })
  return { name, ...info, steps: c.steps.map((s) => s[0]) }
}
