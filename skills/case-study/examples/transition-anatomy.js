// Anatomy of a full-screen transition shader: freeze mid-transition, take over its progress uniform, and switch its ingredients on one
// by one; every stage sweeps progress across the screen. Fill EFFECT, PROGRESS, RANGE and INGREDIENTS from the project's shader
// (read its fragment source: each uniform that adds something on top of a bare cut is an ingredient; a debug uniform is a gift).
// Stages are generated: 00_bare (every ingredient at 0) -> +each ingredient in order -> debug view (if any) -> final.
// usage: OUT=dir node cdp.js <this file> <scrollY mid-transition> [secondsPerSweep=2.5]
const { prelude } = require('../scripts/browser/prelude.js'), { rec } = require('../scripts/browser/rec.js')
const { goTo } = require('../scripts/browser/goto.js')
const EFFECT = 'FILL_ME'                // effect name as map.js lists it (pmndrs postprocessing Effect with a `uniforms` Map)
const PROGRESS = 'uFILL_ME'             // the uniform the site drives from scroll
const RANGE = [0, 1]                    // widen it (e.g. [-0.3, 1.3]) if the edge is skewed or offset and doesn't fully cross the screen
const INGREDIENTS = ['uFILL_ME_A', 'uFILL_ME_B'] // in reveal order
const DEBUG = null                      // e.g. 'uDebug' if the shader has a debug view
const pad = (n) => String(n).padStart(2, '0')
const CONFIGS = [ // cumulative: [name, uniforms to set (values or 'orig')]
  ['00_bare', Object.fromEntries(INGREDIENTS.map((u) => [u, 0]))],
  ...INGREDIENTS.map((u, i) => [`${pad(i + 1)}_plus_${u.replace(/^u/, '').toLowerCase()}`, { [u]: 'orig' }]),
  ...(DEBUG ? [[`${pad(INGREDIENTS.length + 1)}_debug`, { [DEBUG]: 1 }], [`${pad(INGREDIENTS.length + 2)}_final`, { [DEBUG]: 0 }]] : []),
]
module.exports = async (page, y, secs = '2.5') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y, { settle: 3000 })
  await page.evaluate(prelude)
  await page.evaluate((name) => {
    const e = __H.effs.find((e) => e.name === name); __H.ui(0)
    window.__T = { U: (k) => e.uniforms.get(k), orig: Object.fromEntries([...e.uniforms].map(([k, u]) => [k, u.value])) }
  }, EFFECT)
  const frames = Math.round(+secs * 60)
  for (const [name, set] of CONFIGS) {
    await page.evaluate((set) => Object.entries(set).forEach(([k, v]) => __T.U(k) && (__T.U(k).value = v === 'orig' ? __T.orig[k] : v)), set)
    await rec(page, { dir: `${process.env.OUT}/${name}`, frames, perFrame: (i) => `__T.U('${PROGRESS}').value = ${RANGE[0] + (RANGE[1] - RANGE[0]) * (i / (frames - 1))}` })
  }
  await page.evaluate(() => { Object.entries(__T.orig).forEach(([k, v]) => (__T.U(k).value = v)); __H.ui(1) })
  return CONFIGS.map((c) => c[0])
}
