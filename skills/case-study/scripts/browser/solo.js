// Solo every mesh of one scene against a flat grey, one screenshot each. Run this BEFORE writing a layer recipe:
// what the scene graph says and what the camera actually sees often differ (off-frame sets, hidden debug helpers).
// usage: OUT=dir node cdp.js solo.js <scrollY> "<scene predicate: (s, has, cnt) => bool>"
const { prelude } = require('./prelude.js')
const { goTo } = require('./goto.js')
module.exports = async (page, y, pred) => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y)
  await page.evaluate(prelude)
  const ids = await page.evaluate(`(() => {
    const s = __H.pick(${pred}), meshes = [], all = []
    s.traverse((o) => { all.push([o, o.visible]); o.isMesh && meshes.push(o) })
    window.__S = { s, meshes, all, bg: s.background, fog: s.fog }
    const Color = meshes.find((m) => m.material?.color)?.material.color.constructor // THREE.Color without importing three
    s.background = new Color(0x4a4a4a); s.fog = null
    __H.fx(__H.LENS, 0); __H.ui(0)
    return meshes.map((m, i) => i + ':' + __H.cnt(m) + (m.isInstancedMesh ? '×' + m.count : '') + (m.visible ? '' : ' (hidden on site)'))
  })()`)
  for (let i = 0; i < ids.length; i++) {
    await page.evaluate((i) => { __S.all.forEach(([o]) => (o.visible = !o.isMesh)); __S.meshes[i].visible = true; let p = __S.meshes[i].parent; while (p) { p.visible = true; p = p.parent } }, i)
    await new Promise((r) => setTimeout(r, 700))
    await page.screenshot({ path: `${process.env.OUT}/solo_${y}_${String(i).padStart(2, '0')}.jpg`, quality: 55, type: 'jpeg' })
  }
  await page.evaluate(() => { __S.all.forEach(([o, v]) => (o.visible = v)); __S.s.background = __S.bg; __S.s.fog = __S.fog; __H.fx(__H.LENS, 1); __H.ui(1) })
  return ids
}
