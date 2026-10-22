// Hold a scroll position and record; optional push-in toward an object using camera.setViewOffset
// (re-renders a shrinking window around the target, so the close-up stays sharp instead of being a crop).
// usage: OUT=dir node cdp.js hold.js <y> <seconds> ["<scene pred>" "<target pred: (o) => bool>" zoom=3.2] [clean=1]
const { rec } = require('./rec.js'), { prelude } = require('./prelude.js')
const { goTo } = require('./goto.js')
module.exports = async (page, y, secs, scenePred = '', targetPred = '', zoom = '1', clean = '1') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y, { settle: 3000 })
  await page.evaluate(prelude)
  if (clean === '1') await page.evaluate(() => __H.ui(0))
  if (targetPred) await page.evaluate(`(() => {
    const s = __H.pick(${scenePred}), cam = s.children.find((c) => c.isCamera); let t; s.traverse((o) => !t && (${targetPred})(o) && (t = o))
    const p = t.getWorldPosition(t.position.clone()).project(cam)
    window.__P = { cam, cx: (p.x + 1) * 960, cy: (1 - p.y) * 540 }
  })()`)
  const frames = Math.round(+secs * 60)
  await rec(page, { dir: process.env.OUT, frames, perFrame: (i) => (targetPred && +zoom > 1 ? `{ const z = 1 + ${+zoom - 1} * (1 - Math.cos(Math.PI * ${i / (frames - 1)})) / 2, w = 1920 / z, h = 1080 / z;
      __P.cam.setViewOffset(1920, 1080, Math.min(Math.max(__P.cx - w / 2, 0), 1920 - w), Math.min(Math.max(__P.cy - h / 2, 0), 1080 - h), w, h) }` : '0') })
  await page.evaluate(() => { window.__P?.cam.clearViewOffset(); __H.ui(1) })
  return { frames, target: await page.evaluate(() => window.__P && [Math.round(__P.cx), Math.round(__P.cy)]) }
}
