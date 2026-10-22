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
  const vt = window.__vt = {
    on: false, t: 0, d0: 0,
    start() { vt.t = realNow(); vt.d0 = realDate() - vt.t; vt.on = true },
    stop() { vt.on = false; const cbs = q; q = []; cbs.forEach(([, cb]) => realRaf(cb)); try { document.getAnimations().forEach((a) => a.play()) } catch {}; document.querySelectorAll('video[data-vt]').forEach((v) => v.play().catch(() => {})) },
    step(ms = 1000 / 60) {
      vt.t += ms; const cbs = q; q = []; cbs.forEach(([, cb]) => { try { cb(vt.t) } catch (e) { console.error(e) } })
      // CSS animations/transitions (Web Animations API) and <video> don't use rAF: step them by hand so DOM-only sites capture frame-perfect too
      try { document.getAnimations().forEach((a) => { a.pause(); a.currentTime = (a.currentTime ?? 0) + ms }) } catch {}
      document.querySelectorAll('video').forEach((v) => { if (!v.paused) v.pause(); v.dataset.vt = '1'; v.currentTime = (v.currentTime + ms / 1000) % (v.duration || Infinity) })
    },
  }
  performance.now = () => (vt.on ? vt.t : realNow())
  Date.now = () => (vt.on ? vt.t + vt.d0 : realDate())
  window.requestAnimationFrame = (cb) => { const i = ++id; if (vt.on) q.push([i, cb]); else realRaf((t) => (vt.on ? q.push([i, cb]) : cb(t))); return i }
  window.cancelAnimationFrame = (i) => { q = q.filter(([j]) => j !== i) }
}
