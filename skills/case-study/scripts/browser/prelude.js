// In-page helpers shared by the capture tasks. Evaluated in the page (it is a function body run via page.evaluate).
// Exposes window.__H: has(obj,pred), cnt(mesh) (vertex count), pick(pred) -> first big scene matching,
// fx(regex, on) fades postprocessing effects whose name matches (restores their original opacity), ui(on) hides every DOM node but the canvas.
module.exports.prelude = () => {
  window.__big = __cap.scenes.filter((s) => s.children.length > 2) // re-scan: chapters lazy-load as you scroll
  const has = (o, f) => { let r = false; o.traverse((c) => f(c) && (r = true)); return r }
  const cnt = (o) => o.geometry?.attributes?.position?.count
  const effs = __cap.passes.flatMap((p) => p.effects || [])
  window.__orig = window.__orig || { opac: new Map() }
  effs.forEach((e) => !__orig.opac.has(e) && __orig.opac.set(e, e.blendMode?.opacity?.value))
  window.__H = {
    has, cnt, effs,
    pick: (pred) => __big.find((s) => pred(s, has, cnt)),
    fx(re, on) { effs.filter((e) => re.test(e.name)).forEach((e) => e.blendMode && (e.blendMode.opacity.value = on ? __orig.opac.get(e) : 0)) },
    ui(on) {
      let st = document.getElementById('__ui')
      if (!st) { st = document.createElement('style'); st.id = '__ui'; document.head.append(st) }
      st.textContent = on ? '' : 'body *{visibility:hidden!important} canvas{visibility:visible!important}'
    },
  }
  return { bigScenes: __big.length, effects: [...new Set(effs.map((e) => e.name))] }
}
