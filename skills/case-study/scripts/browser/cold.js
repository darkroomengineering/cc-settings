// Record a page frame-perfect from its first paint: preloader, intro, reveal. The hook and the frozen clock are in place before the page's
// own scripts run; network loads keep running in real time meanwhile.
// usage: OUT=dir node cdp.js cold.js <url> <seconds>
// env HIDE="<css selectors>" hides dev overlays / consent banners from the first frame; COOKIES, TIMERS, BLOCK, FAKE_OK as in boot.js.
const fs = require('node:fs'), { rec } = require('./rec.js'), { fitWindow, inject } = require('./boot.js')
module.exports = async (page, url, secs) => {
  await fitWindow(page)
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await inject(page)
  if (process.env.HIDE) await page.evaluateOnNewDocument((css) => document.addEventListener('DOMContentLoaded', () => { const s = document.createElement('style'); s.textContent = `${css} { display: none !important }`; document.head.append(s) }), process.env.HIDE)
  if (process.env.COOKIES) {
    const host = new URL(url).hostname
    await page.setCookie(...process.env.COOKIES.split(';').map((c) => c.trim()).filter(Boolean).map((c) => { const [name, ...v] = c.split('='); return { name, value: v.join('='), domain: host, path: '/' } }))
  }
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 })
  const frames = Math.round(+secs * 60)
  await rec(page, { dir: process.env.OUT, frames })
  return { frames }
}
