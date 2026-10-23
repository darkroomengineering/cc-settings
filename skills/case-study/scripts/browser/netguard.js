// Keeps a capture from writing to the client's production: score uploads, lead / sign-up forms, analytics, anonymous auth.
// BLOCK="<regex>"   requests whose URL matches fail in the page (fetch rejects, XHR goes nowhere, sendBeacon is dropped)
// FAKE_OK="<regex>" requests whose URL matches get an empty 200 JSON answer from the page itself, so success screens still show
// boot.js and cold.js install it before the page's scripts when either variable is set. A page loaded before you set them has no
// guard: install it live with `BLOCK=… FAKE_OK=… node cdp.js netguard.js [probeUrl]`, which also proves the stub answers locally.
const init = (block, fake) => {
  const B = block ? new RegExp(block) : null, F = fake ? new RegExp(fake) : null
  const prev = window.fetch, url = (u) => String(u?.url || u)
  window.fetch = (u, o) => {
    if (F && F.test(url(u))) return Promise.resolve(new Response('{}', { status: 200, headers: { 'content-type': 'application/json' } }))
    if (B && B.test(url(u))) return Promise.reject(new TypeError('blocked by case-study capture'))
    return prev(u, o)
  }
  window.fetch.__guard = true
  const open = XMLHttpRequest.prototype.open
  XMLHttpRequest.prototype.open = function (m, u, ...r) { if ((B && B.test(String(u))) || (F && F.test(String(u)))) u = 'data:application/json,{}'; return open.call(this, m, u, ...r) }
  const beacon = navigator.sendBeacon?.bind(navigator)
  navigator.sendBeacon = (u, d) => ((B && B.test(String(u))) || (F && F.test(String(u))) ? true : beacon?.(u, d))
}
module.exports = async (page, probe) => page.evaluate(async (fn, block, fake, probe) => {
  if (!window.fetch.__guard) (0, eval)(`(${fn})`)(block, fake)
  if (!probe) return { guarded: true }
  const r = await window.fetch(probe, { method: 'POST', body: '{"probe":true}' }).then((r) => r.status, (e) => String(e))
  return { guarded: true, probe, answer: r }
}, init.toString(), process.env.BLOCK || '', process.env.FAKE_OK || '', probe || '')
module.exports.init = init
