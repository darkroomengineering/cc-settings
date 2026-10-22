// Anatomy of a full-screen transition shader: freeze mid-transition, take over its progress uniform, and switch its ingredients on one
// by one (each config sweeps progress across the screen). Adapt EFFECT, PROGRESS, the range and CONFIGS to the project's shader
// (read its fragment source: every uniform that shapes the edge is an ingredient; a debug uniform is a gift).
// usage: OUT=dir node cdp.js <this file> <scrollY mid-transition> [secondsPerSweep=2.5]
const { prelude } = require('../scripts/browser/prelude.js'), { rec } = require('../scripts/browser/rec.js')
const { goTo } = require('../scripts/browser/goto.js')
const EFFECT = 'TransitionEffect', PROGRESS = 'uProgress', RANGE = [-0.35, 1.35]
const CONFIGS = [ // cumulative: [name, uniforms to set (values or 'orig')]
  ['01_hard_wipe', { uEdge: 0, uNoise: 0, uDisplace: 0, uBlur: 0, uSeam: 0 }],
  ['02_edge', { uEdge: 'orig' }],
  ['03_noise', { uNoise: 'orig' }],
  ['04_displacement', { uDisplace: 'orig' }],
  ['05_blur', { uBlur: 'orig' }],
  ['06_seam', { uSeam: 'orig' }],
  ['07_debug', { uDebug: 1 }],
  ['08_final', { uDebug: 0 }],
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
