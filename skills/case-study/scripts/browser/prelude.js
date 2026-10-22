// In-page helpers shared by the capture tasks. Evaluated in the page (it is a function body run via page.evaluate).
// Exposes window.__H: has(obj,pred), cnt(mesh) (vertex count), pick(pred) -> first big scene matching,
// fx(regex, on) toggles postprocessing by name: pmndrs effects via blend opacity, three/examples passes via `enabled` (originals restored);
// ui(on) hides every DOM node but the canvas; css(selector, on) hides/shows DOM elements (for DOM layers and overlays).
module.exports.prelude = () => {
  window.__big = __cap.scenes.filter((s) => s.children.length > 2) // re-scan: chapters lazy-load as you scroll
  const has = (o, f) => { let r = false; o.traverse((c) => f(c) && (r = true)); return r }
  const cnt = (o) => o.geometry?.attributes?.position?.count
  const name = (o) => o.name || o.constructor?.name || ''
  const effs = __cap.passes.flatMap((p) => (p.effects ? p.effects : p.isPass ? [p] : [])) // pmndrs: effects inside EffectPasses; three: the pass itself
  window.__orig = window.__orig || { opac: new Map() }
  effs.forEach((e) => !__orig.opac.has(e) && __orig.opac.set(e, e.blendMode ? e.blendMode.opacity.value : e.enabled))
  const STRUCTURAL = /^(RenderPass|OutputPass|ClearPass|ClearMaskPass|MaskPass|CopyPass|TexturePass|SavePass)$/ // never switched off: they ARE the image
  window.__H = {
    has, cnt, effs,
    LENS: /Bloom|Chromatic|Vignette|Noise|Grain|Film|Glitch|Scanline|DotScreen|Pixel|Bokeh|DepthOfField|Afterimage|ToneMapping|Outline|LUT|Halftone/,
    pick: (pred) => __big.find((s) => pred(s, has, cnt)),
    fx(re, on) { effs.filter((e) => re.test(name(e)) && !STRUCTURAL.test(name(e))).forEach((e) => { if (e.blendMode) e.blendMode.opacity.value = on ? __orig.opac.get(e) : 0; else e.enabled = on ? __orig.opac.get(e) : false }) },
    // css(sel, true) forces visible (beats a hidden parent), css(sel, false) hides, css(sel) resets to the page's own value
    css(sel, on) { document.querySelectorAll(sel).forEach((el) => (on === undefined ? el.style.removeProperty('visibility') : el.style.setProperty('visibility', on ? 'visible' : 'hidden', 'important'))) },
    ui(on) {
      let st = document.getElementById('__ui')
      if (!st) { st = document.createElement('style'); st.id = '__ui'; document.head.append(st) }
      st.textContent = on ? '' : 'body *{visibility:hidden!important} canvas{visibility:visible!important}'
    },
  }
  return { bigScenes: __big.length, effects: [...new Set(effs.map(name))] }
}
