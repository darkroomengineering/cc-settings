// An interaction as shipped: hold a scroll position, click at an exact frame, record. Lay the matching sound at clickAt in post.
// usage: OUT=dir node cdp.js click.js <y> [seconds=7] [clickAt=0.6] [x,y=1500,820]
const { rec } = require('./rec.js')
const { goTo } = require('./goto.js')
module.exports = async (page, y, secs = '7', clickAt = '0.6', xy = '1500,820') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y, { settle: 3000 })
  const f = Math.round(+secs * 60), cf = Math.round(+clickAt * 60), [x, yy] = xy.split(',').map(Number)
  await rec(page, { dir: process.env.OUT, frames: f, hook: async (i) => { if (i === cf) await page.mouse.click(x, yy) } })
  return { frames: f, clickFrame: cf, clickSeconds: cf / 60 }
}
