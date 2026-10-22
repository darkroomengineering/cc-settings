// usage: node cdp.js <task.js> [args...]   task.js exports async (page, ...args) => any (printed as JSON)
// Connects to chrome.sh's instance (CDP_URL, default http://127.0.0.1:9333). Needs puppeteer-core: `npm i --prefix <this dir> puppeteer-core`.
const path = require('node:path')
const puppeteer = require(require.resolve('puppeteer-core', { paths: [__dirname, process.cwd()] }))
;(async () => {
  const browser = await puppeteer.connect({ browserURL: process.env.CDP_URL || 'http://127.0.0.1:9333', defaultViewport: null })
  const pages = await browser.pages()
  const page = pages.find((p) => process.env.PAGE_MATCH && p.url().includes(process.env.PAGE_MATCH)) || pages.find((p) => p.url().startsWith('http')) || pages[0]
  if (process.env.LOG) page.on('console', (m) => console.log('[page]', m.text()))
  const task = require(path.resolve(process.argv[2]))
  const res = await task(page, ...process.argv.slice(3))
  if (res !== undefined) console.log(typeof res === 'string' ? res : JSON.stringify(res, null, 1))
  browser.disconnect()
})().catch((e) => { console.error(e); process.exit(1) })
