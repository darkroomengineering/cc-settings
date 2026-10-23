// Scroll to y the way a visitor would: in steps, letting each frame render. A direct jump skips the scroll-driven animation of every
// section in between (Theatre sequences, ScrollTriggers, reveal states), which leaves stale titles and half-played transitions on screen.
// Pages that scroll an inner element (a Lenis wrapper, an overflow container) instead of the window: set SCROLLER="<css selector>".
const S = process.env.SCROLLER ? JSON.stringify(process.env.SCROLLER) : ''
// JS (as a string) that scrolls the page or the SCROLLER element to v, for page.evaluate / rec perFrame
module.exports.scrollJs = (v) => (S ? `document.querySelector(${S}).scrollTop = ${v}` : `scrollTo(0, ${v})`)
const current = (page) => page.evaluate(S ? `document.querySelector(${S}).scrollTop` : 'scrollY')
module.exports.goTo = async (page, y, { step = 300, pause = 40, settle = 2500 } = {}) => {
  const from = await current(page)
  const n = Math.max(1, Math.ceil(Math.abs(+y - from) / step))
  for (let i = 1; i <= n; i++) {
    await page.evaluate(module.exports.scrollJs(from + ((+y - from) * i) / n))
    await new Promise((r) => setTimeout(r, pause))
  }
  await new Promise((r) => setTimeout(r, settle))
}
