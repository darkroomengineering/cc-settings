// Scripted play for games and app journeys: each frame, read what is on screen, decide (rules), act with real input, step the clock,
// screenshot. Frame-perfect like rec.js, but adaptive: cuts land on real game beats because every click, key and phase is logged.
// Copy to <assets>/_toolkit/play.js and fill in RULES / move(). Boot with TIMERS=1 (and BLOCK / FAKE_OK) first:
//   TIMERS=1 BLOCK="supabase\.co|analytics" FAKE_OK="/api/signup" node cdp.js boot.js <url>
//   OUT=<WORK>/play_good node cdp.js <path>/play.js good 300
// Worked example: a past game case study's `<project>-case-study-assets/_toolkit/play.js` (a maze game with five mini-games).
// Lessons from it, all cost a re-take:
// - Guard every rule with state flags. A rule that matches on button text re-fires on anything showing that text again
//   (a picked dropdown value appears in its trigger; "Share" exists on two screens). Order rules so a gate can't starve the next step.
// - Resolve each click at its own frame (targets move); glide the pointer first so hover states and pointer-driven cameras look real.
// - Centred text inputs put the caret before the text on click: press End before deleting or typing. Expect client-side validation
//   (a business-email check rejected example.com) and keep the refusal: it is a real beat.
// - Stop a take cleanly from outside by deleting window.__probe: the loop throws, `finally` writes events.json and the sound log.
// - A take that goes wrong mid-way doesn't need a redo from the start: fix the rule and continue on the same live page into a new folder,
//   then stitch with media/join_takes.py.
const fs = require('node:fs')

module.exports = async (page, scenario = 'main', maxSecs = '300') => {
  const dir = process.env.OUT; fs.mkdirSync(dir, { recursive: true })
  const cdp = await page.createCDPSession()
  await page.evaluate(() => {
    window.__ev = []
    // log every sound the page starts, with its virtual time (Howler shown; wrap HTMLMediaElement.play or an AudioBufferSourceNode the same way)
    if (window.Howl && !Howl.prototype.__p) { const p = Howl.prototype.play; Howl.prototype.play = function (...a) { __ev.push({ t: performance.now(), sound: String(this._src).split('/').pop() }); return p.apply(this, a) }; Howl.prototype.__p = true }
    // what is clickable right now: visible, on top at its centre, fully opaque
    window.__probe = () => ({
      btns: [...document.querySelectorAll('button, a, li, label')].map((b) => {
        const r = b.getBoundingClientRect(); if (r.width < 4 || r.height < 4) return null
        const x = r.x + r.width / 2, y = r.y + r.height / 2, top = document.elementFromPoint(x, y)
        if (!top || !(b === top || b.contains(top))) return null
        let o = 1; for (let e = b; e; e = e.parentElement) o *= +getComputedStyle(e).opacity
        return o < 0.9 ? null : { text: b.innerText.trim().replace(/\s+/g, ' '), tag: b.tagName, cls: String(b.className), x, y }
      }).filter(Boolean),
      // add the game state you steer by: a player position from the scene graph, a "controls enabled" marker, the current screen
    })
  })
  const ev = [], since = {}, flags = {}
  let frame = 0, queue = [], mouse = [960, 540], cur = []
  const log = (o) => ev.push({ frame, s: +(frame / 60).toFixed(3), ...o })
  const glide = (x, y, n, then) => { const [x0, y0] = mouse; for (let k = 1; k <= n; k++) { const t = (1 - Math.cos((Math.PI * k) / n)) / 2; queue.push(async () => { mouse = [x0 + (x - x0) * t, y0 + (y - y0) * t]; await page.mouse.move(...mouse) }) } queue.push(then) }
  const clickWhere = (match, n = 16) => glide(cur.find(match).x, cur.find(match).y, n, async () => {
    const b = (await page.evaluate(() => __probe())).btns.find(match); if (!b) return
    mouse = [b.x, b.y]; await page.mouse.click(b.x, b.y); log({ click: b.text || b.cls })
  })
  // [name, match(button), frames it must have been visible (reading time), guard()]
  const RULES = {
    main: [
      ['start', (b) => b.text === 'Start', 120],
      ['next', (b) => b.text === 'Continue', 100, () => !flags.done],
    ],
  }[scenario]
  await page.evaluate(() => { __vt.start(); window.__t0 = performance.now() })
  try {
    for (frame = 0; frame < +maxSecs * 60; frame++) {
      const p = await page.evaluate(() => __probe())
      cur = p.btns; const vis = new Set(cur.map((b) => b.text))
      for (const t of Object.keys(since)) if (!vis.has(t)) delete since[t]
      for (const t of vis) since[t] ??= frame
      if (queue.length) await queue.shift()()
      else {
        const r = RULES.find(([, m, minVis, guard]) => { const b = cur.find(m); return b && frame - since[b.text] >= minVis && (!guard || guard()) })
        if (r) { flags[r[0]] = frame; clickWhere(r[1]) }
        // else: hold keys / steer the player toward the next goal from p (see the worked example's route following)
      }
      if (flags.stopAt && frame >= flags.stopAt) break
      await page.evaluate(() => __vt.step(1000 / 60))
      await page.evaluate(() => new Promise((r) => setTimeout(r, 0)))
      const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 95, optimizeForSpeed: true })
      fs.writeFileSync(`${dir}/f_${String(frame).padStart(5, '0')}.jpg`, Buffer.from(data, 'base64'))
      if (frame % 600 === 0) fs.writeFileSync(`${dir}/events.json`, JSON.stringify({ ev, frame }, null, 1))
    }
  } finally {
    const sounds = await page.evaluate(() => __ev.map((e) => ({ ...e, frame: Math.round((e.t - __t0) / (1000 / 60)) }))).catch(() => [])
    await page.evaluate(() => __vt.stop()).catch(() => {})
    fs.writeFileSync(`${dir}/events.json`, JSON.stringify({ ev, sounds, frames: frame }, null, 1))
  }
  return { frames: frame, events: ev.length }
}
