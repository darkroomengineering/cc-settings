// Injected after hook.js when TIMERS=1 (boot.js, cold.js): puts setTimeout/setInterval on the virtual clock as well.
// Games and app flows run movement, countdowns and challenge timers on JS timers; with only rAF frozen they would race ~10x ahead
// of the captured frames. Delay-0 timers stay real (rec.js settles each frame with setTimeout(r, 0)). window.__vtimers is the queue.
{
  const realST = window.setTimeout.bind(window), realCT = window.clearTimeout.bind(window)
  const T = (window.__vtimers = new Map()); let id = 1e6
  const now = () => performance.now()
  const arm = (e) => { if (!__vt.on) e.real = realST(() => fire(e), Math.max(0, e.due - now())) }
  const fire = (e) => {
    if (!T.has(e.id)) return
    if (e.every) { e.due += e.ms; arm(e) } else T.delete(e.id)
    try { typeof e.fn === 'function' ? e.fn(...e.args) : (0, eval)(e.fn) } catch (err) { console.error(err) }
  }
  const add = (fn, ms, args, every) => {
    ms = Math.max(0, +ms || 0)
    if (!every && ms === 0) return realST(fn, 0, ...args)
    const e = { id: ++id, fn, ms: Math.max(ms, every ? 1 : 0), args, every, due: now() + ms }
    T.set(e.id, e); arm(e); return e.id
  }
  window.setTimeout = (fn, ms, ...a) => add(fn, ms, a, false)
  window.setInterval = (fn, ms, ...a) => add(fn, ms, a, true)
  window.clearTimeout = window.clearInterval = (i) => { const e = T.get(i); if (e) { realCT(e.real); T.delete(i) } else realCT(i) }
  const { start, step, stop } = __vt
  __vt.start = () => { start(); T.forEach((e) => realCT(e.real)) }
  __vt.stop = () => { stop(); T.forEach((e) => { e.due = Math.min(e.due, now() + e.ms); arm(e) }) }
  __vt.step = (ms) => {
    step(ms)
    for (let guard = 0; guard < 1000; guard++) {
      let next = null
      T.forEach((e) => { if (e.due <= __vt.t && (!next || e.due < next.due)) next = e })
      if (!next) break
      fire(next)
    }
  }
}
