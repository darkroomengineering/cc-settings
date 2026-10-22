// Scroll to y the way a visitor would: in steps, letting each frame render. A direct jump skips the scroll-driven animation of every
// section in between (Theatre sequences, ScrollTriggers, reveal states), which leaves stale titles and half-played transitions on screen.
module.exports.goTo = async (page, y, { step = 300, pause = 40, settle = 2500 } = {}) => {
  const from = await page.evaluate(() => scrollY)
  const n = Math.max(1, Math.ceil(Math.abs(+y - from) / step))
  for (let i = 1; i <= n; i++) {
    await page.evaluate((v) => scrollTo(0, v), from + ((+y - from) * i) / n)
    await new Promise((r) => setTimeout(r, pause))
  }
  await new Promise((r) => setTimeout(r, settle))
}
