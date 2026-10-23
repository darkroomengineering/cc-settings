// Constant-speed scroll capture, frame-perfect. Linear on purpose: editors retime in post.
// usage: OUT=dir node cdp.js film.js <y0> <y1> <seconds> [clean=0]   (clean=1 hides the DOM UI, canvas only)
// SCROLLER="<css>" for pages that scroll an inner element instead of the window (see goto.js).
const { rec } = require('./rec.js'), { prelude } = require('./prelude.js')
const { goTo, scrollJs } = require('./goto.js')
module.exports = async (page, y0, y1, secs, clean = '0') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y0, { settle: 3000 })
  if (clean === '1') { await page.evaluate(prelude); await page.evaluate(() => __H.ui(0)) }
  const frames = Math.round(+secs * 60), t = Date.now()
  await rec(page, { dir: process.env.OUT, frames, warm: 5, perFrame: (i) => scrollJs(+y0 + (+y1 - +y0) * (i / (frames - 1))) })
  if (clean === '1') await page.evaluate(() => __H.ui(1))
  return { frames, wallSeconds: (Date.now() - t) / 1000 }
}
