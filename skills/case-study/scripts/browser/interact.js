// Scripted input at exact frames, recorded frame-perfect: hovers, cursor sweeps, clicks, drags, keys (team grids, menus, editors, carousels).
// usage: OUT=dir node cdp.js interact.js <y> <seconds> "<actions>"
//   actions, ';'-separated (F = frame at 60 fps):
//     F:click:X,Y   F:move:X,Y   F:down:X,Y   F:up:X,Y   F:key:Escape   F:wheel:DY (at the viewport centre)
//     F:sel:<css>[@n]               click the n-th match's centre, resolved at that frame, so layout changes don't matter
//     F0-F1:path:X0,Y0:X1,Y1        move every frame, eased (glide to a target before clicking it, so pointer-driven cameras stay smooth)
//     F0-F1:drag:X0,Y0:X1,Y1        press, move eased, release
// e.g. "30-59:path:960,540:1069,678;60:sel:#cta;200:key:ArrowRight". Returns frame→action times so sounds can be laid on in post.
// For a multi-page journey, start on the first page (boot.js) and click through: the in-app navigation is part of the shot.
const { rec } = require('./rec.js'), { goTo } = require('./goto.js')
module.exports = async (page, y, secs, actions = '') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  await goTo(page, y, { settle: 3000 })
  const acts = actions.split(';').map((a) => a.trim()).filter(Boolean).map((a) => {
    const [fr, type, ...rest] = a.split(':'); const [f0, f1 = f0] = fr.split('-').map(Number)
    return { f0, f1, type, args: rest.map((r) => r.split(',').map(Number)), raw: rest.join(':') }
  })
  const centre = (spec) => page.evaluate((spec) => {
    const [css, n = '0'] = spec.split('@'), e = document.querySelectorAll(css)[+n]
    if (!e) return null; const b = e.getBoundingClientRect(); return [b.x + b.width / 2, b.y + b.height / 2]
  }, spec)
  const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2
  const frames = Math.round(+secs * 60), log = []
  await rec(page, { dir: process.env.OUT, frames, hook: async (i) => {
    for (const a of acts) {
      if (i < a.f0 || i > a.f1) continue
      const [x, yy] = a.args[0] || [], t = ease((i - a.f0) / Math.max(1, a.f1 - a.f0)), at = {}
      if (a.type === 'click' && i === a.f0) await page.mouse.click(x, yy)
      else if (a.type === 'sel' && i === a.f0) { const c = await centre(a.raw); at.at = c && c.map(Math.round); if (c) await page.mouse.click(...c); else at.missing = a.raw }
      else if (a.type === 'move' && i === a.f0) await page.mouse.move(x, yy)
      else if (a.type === 'down' && i === a.f0) { await page.mouse.move(x, yy); await page.mouse.down() }
      else if (a.type === 'up' && i === a.f0) { await page.mouse.move(x, yy); await page.mouse.up() }
      else if (a.type === 'key' && i === a.f0) await page.keyboard.press(a.raw)
      else if (a.type === 'wheel' && i === a.f0) { await page.mouse.move(960, 540); await page.mouse.wheel({ deltaY: x }) }
      else if (a.type === 'path') { const [x1, y1] = a.args[1]; await page.mouse.move(x + (x1 - x) * t, yy + (y1 - yy) * t) }
      else if (a.type === 'drag') {
        const [x1, y1] = a.args[1]
        if (i === a.f0) { await page.mouse.move(x, yy); await page.mouse.down() }
        await page.mouse.move(x + (x1 - x) * t, yy + (y1 - yy) * t)
        if (i === a.f1) await page.mouse.up()
      }
      else continue
      if (i === a.f0) log.push({ frame: i, seconds: +(i / 60).toFixed(3), action: a.type, ...at })
    }
  } })
  return { frames, actions: log }
}
