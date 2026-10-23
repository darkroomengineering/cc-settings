// Captures three/postprocessing instances as they're constructed: an Object.prototype setter fires on `this.isScene = true` etc.
window.__cap = { scenes: [], renderers: [], passes: [] }
const trap = (key, test, list) => Object.defineProperty(Object.prototype, key, {
  configurable: true,
  set(v) {
    try { Object.defineProperty(this, key, { value: v, writable: true, configurable: true, enumerable: true }) } catch { return } // frozen objects: leave them alone
    try { if (test(this, v)) window.__cap[list].push(this) } catch {}
  },
})
trap('isScene', (o, v) => v === true, 'scenes')
trap('isWebGLRenderer', (o, v) => v === true, 'renderers')
trap('effects', (o, v) => Array.isArray(v) && 'fullscreenMaterial' in o, 'passes') // pmndrs postprocessing EffectPass (R3F)
trap('isPass', (o, v) => v === true, 'passes') // three/examples EffectComposer passes (ShaderPass, UnrealBloomPass, ...)
const st = document.createElement('style'); st.id = '__cs'
st.textContent = 'nextjs-portal{display:none!important}' // hide the Next.js dev badge
document.addEventListener('DOMContentLoaded', () => document.head.append(st))

// Virtual clock: __vt.start() freezes time; __vt.step(ms) advances it and runs queued rAF callbacks (frame-perfect capture)
{
  const realNow = performance.now.bind(performance), realRaf = window.requestAnimationFrame.bind(window), realDate = Date.now
  let q = [], id = 0
  // Videos, including off-DOM ones feeding WebGL textures: remember which ones the page wants playing, and play them by stepping
  // currentTime while the clock is frozen (a non-looping video fires 'ended' when it reaches its end, as sites wait for that).
  const M = HTMLMediaElement.prototype, realPlay = M.play, realPause = M.pause, vids = new Set()
  M.play = function () { if (this instanceof HTMLVideoElement) { vids.add(this); this.__vtWant = true; if (vt.on) return Promise.resolve() } return realPlay.call(this) }
  M.pause = function () { this.__vtWant = false; return realPause.call(this) }
  const videos = () => new Set([...vids, ...document.querySelectorAll('video')])
  const vt = window.__vt = {
    on: false, t: 0, d0: 0,
    start() {
      vt.t = realNow(); vt.d0 = realDate() - vt.t; vt.on = true
      videos().forEach((v) => { if (!v.paused) { v.__vtWant = true; realPause.call(v) } })
    },
    stop() {
      vt.on = false; const cbs = q; q = []; cbs.forEach(([, cb]) => realRaf(cb)); try { document.getAnimations().forEach((a) => a.play()) } catch {}
      videos().forEach((v) => v.__vtWant && realPlay.call(v).catch(() => {}))
    },
    step(ms = 1000 / 60) {
      vt.t += ms; const cbs = q; q = []; cbs.forEach(([, cb]) => { try { cb(vt.t) } catch (e) { console.error(e) } })
      // CSS animations/transitions (Web Animations API) and <video> don't use rAF: step them by hand so DOM-only sites capture frame-perfect too
      try { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = (a.currentTime ?? 0) + ms }) } catch {}
      videos().forEach((v) => {
        if (!v.__vtWant) return
        if (!v.paused) realPause.call(v)
        const d = v.duration || Infinity, t = v.currentTime + ms / 1000
        if (v.loop) v.currentTime = t % d
        else if (t < d) v.currentTime = t
        else { v.currentTime = d; v.__vtWant = false; v.dispatchEvent(new Event('ended')) }
      })
    },
  }
  performance.now = () => (vt.on ? vt.t : realNow())
  Date.now = () => (vt.on ? vt.t + vt.d0 : realDate())
  window.requestAnimationFrame = (cb) => { const i = ++id; if (vt.on) q.push([i, cb]); else realRaf((t) => (vt.on ? q.push([i, cb]) : cb(t))); return i }
  window.cancelAnimationFrame = (i) => { q = q.filter(([j]) => j !== i) }
}
