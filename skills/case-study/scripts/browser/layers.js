// Decompose one chapter: apply a recipe's steps one by one -> stills (NN_label.png) + a live build video (frames, one step every `per` s).
// usage: OUT=dir node cdp.js layers.js <recipes.js> <setName> [per=1.25]
// recipes.js exports { setName: { y, scene: '(s, has, cnt) => bool', steps: [[label, code], ...] } }.
// Step code runs with: s (scene), k (children), cnt, has, inst (instanced meshes inside originally-visible groups),
// O (original background/fog/visibility), only(f) (hide all but camera + matches), show(f), uni(f) (uniforms of matches), fx(re,on), ui(on).
const path = require('node:path'), fs = require('node:fs')
const { prelude } = require('./prelude.js'), { rec } = require('./rec.js')
const wait = (ms) => new Promise((r) => setTimeout(r, ms))
module.exports = async (page, recipesPath, name, per = '1.25') => {
  const c = require(path.resolve(recipesPath))[name], dir = `${process.env.OUT}/${name}`
  fs.mkdirSync(`${dir}/stills`, { recursive: true })
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await page.evaluate((y) => scrollTo(0, y), c.y); await wait(3000)
  await page.evaluate(prelude)
  const info = await page.evaluate(`(() => {
    const { has, cnt } = __H, s = __H.pick(${c.scene}), k = s.children
    const inst = []; k.forEach((o) => o.visible && o.traverse((m) => m.isInstancedMesh && inst.push(m)))
    const O = { bg: s.background, fog: s.fog, vis: k.map((o) => o.visible) }
    const only = (f) => k.forEach((o) => (o.visible = o.isCamera || !!f(o)))
    const show = (f) => k.forEach((o) => f(o) && (o.visible = true))
    const uni = (f) => k.filter((o) => f(o) && o.material?.uniforms).map((o) => o.material.uniforms)
    window.__C = { s, k, cnt, has, inst, O, only, show, uni, fx: __H.fx, ui: __H.ui }
    return { children: k.length, instanced: inst.map((m) => cnt(m) + '×' + m.count) }
  })()`)
  const slug = (l) => l.toLowerCase().replace(/\W+/g, '_').replace(/^_|_$/g, '')
  for (const [i, [label, code]] of c.steps.entries()) {
    await page.evaluate(`with(__C){${code}}`); await wait(900)
    await page.screenshot({ path: `${dir}/stills/${String(i + 1).padStart(2, '0')}_${slug(label)}.png` })
  }
  const n = Math.round(+per * 60)
  await rec(page, { dir: `${dir}/build`, frames: n * c.steps.length + 90, perFrame: (i) => (i % n === 0 && i / n < c.steps.length ? `with(__C){${c.steps[i / n][1]}}` : '0') })
  return { name, ...info, steps: c.steps.map((s) => s[0]) }
}
