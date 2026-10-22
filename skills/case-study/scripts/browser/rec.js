// Frame-perfect recorder: freezes the page clock (hook.js __vt), steps 1/fps, screenshots every frame.
// rec(page, { dir, frames, fps=60, perFrame(i) -> js string evaluated before the step, hook(i) async (real input, e.g. clicks), warm })
const fs = require('node:fs')
module.exports.rec = async (page, { dir, frames, fps = 60, perFrame, hook, warm = 0, quality = 95 }) => {
  fs.mkdirSync(dir, { recursive: true })
  const cdp = await page.createCDPSession()
  await page.evaluate(() => __vt.start())
  try {
    for (let i = -warm; i < frames; i++) {
      if (perFrame) await page.evaluate(perFrame(Math.max(i, 0)))
      if (hook && i >= 0) await hook(i)
      await page.evaluate((ms) => __vt.step(ms), 1000 / fps)
      await page.evaluate(() => new Promise((r) => setTimeout(r, 0)))
      if (i < 0) continue
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality, optimizeForSpeed: true })
      fs.writeFileSync(`${dir}/f_${String(i).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'))
    }
  } finally {
    await page.evaluate(() => __vt.stop()).catch(() => {})
  }
}
