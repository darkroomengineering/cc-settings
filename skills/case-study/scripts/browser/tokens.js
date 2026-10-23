// Colours and typography as the live site uses them, for any stack (no source conventions assumed).
// usage: OUT=tokens.json node cdp.js tokens.js [y1,y2,…]   (visits the positions like a visitor so lazy sections render)
// Multi-page sites: PAGES="https://site/,https://site/about" visits each page in turn (same y positions on each) and merges the results.
// HIDE="<css selectors>" hides dev overlays / consent banners on every page so their styles aren't counted.
// Collects: @font-face rules (family, weight, style, absolute src), every rendered text style (family, size, line-height, tracking,
// weight, case, colour) with counts and a real sample, :root CSS custom properties holding colours, and the colours in use.
const fs = require('node:fs'), { goTo } = require('./goto.js')
module.exports = async (page, ys = '') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  const styles = new Map(), colors = new Map()
  const positions = ys ? ys.split(',').map(Number) : [0]
  const pages = process.env.PAGES ? process.env.PAGES.split(',') : [null]
  for (const url of pages) {
  if (url) { await page.goto(url, { waitUntil: 'load', timeout: 120000 }); await new Promise((r) => setTimeout(r, 4000)) }
  if (process.env.HIDE) await page.addStyleTag({ content: `${process.env.HIDE} { display: none !important }` })
  for (const y of positions) {
    await goTo(page, y, { settle: 1200 })
    const r = await page.evaluate(() => {
      const out = { styles: [], colors: [] }
      const vis = (el) => { const b = el.getBoundingClientRect(), cs = getComputedStyle(el); return b.width > 0 && b.height > 0 && b.bottom > 0 && b.top < innerHeight && cs.visibility !== 'hidden' && +cs.opacity > 0.05 }
      for (const el of document.querySelectorAll('body *')) {
        if (['SCRIPT', 'STYLE', 'NOSCRIPT', 'svg', 'path'].includes(el.tagName) || !vis(el)) continue
        const cs = getComputedStyle(el)
        const own = [...el.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim()
        if (own.length > 1) {
          const fam = cs.fontFamily.split(',')[0].replace(/["']/g, '').trim()
          const key = [fam, cs.fontSize, cs.lineHeight, cs.letterSpacing, cs.fontWeight, cs.fontStyle, cs.textTransform, cs.fontVariationSettings].join('|')
          out.styles.push({ key, family: cs.fontFamily, fam, size: cs.fontSize, lineHeight: cs.lineHeight, letterSpacing: cs.letterSpacing, weight: cs.fontWeight, style: cs.fontStyle, transform: cs.textTransform, variation: cs.fontVariationSettings, features: cs.fontFeatureSettings, color: cs.color, tag: el.tagName.toLowerCase(), cls: String(el.className?.baseVal ?? el.className).slice(0, 60), sample: own.slice(0, 90) })
        }
        for (const p of ['color', 'backgroundColor', 'borderTopColor']) {
          const v = cs[p]; if (!v || v === 'rgba(0, 0, 0, 0)' || (p === 'borderTopColor' && cs.borderTopWidth === '0px')) continue
          out.colors.push({ v, p })
        }
      }
      return out
    })
    for (const s of r.styles) { const e = styles.get(s.key); if (e) e.count++; else styles.set(s.key, { ...s, count: 1, firstY: y }) }
    for (const c of r.colors) { const e = colors.get(c.v) || { value: c.v, count: 0, as: {} }; e.count++; e.as[c.p] = (e.as[c.p] || 0) + 1; colors.set(c.v, e) }
  }
  }
  const sheets = await page.evaluate(() => {
    const faces = [], vars = []
    for (const sh of document.styleSheets) {
      let rules; try { rules = sh.cssRules } catch { continue } // cross-origin sheets can't be read
      const walk = (rs) => { for (const r of rs) {
        if (r.type === CSSRule.FONT_FACE_RULE) {
          const src = r.style.getPropertyValue('src'), urls = [...src.matchAll(/url\(["']?([^"')]+)["']?\)/g)].map((m) => new URL(m[1], sh.href || location.href).href)
          faces.push({ family: r.style.getPropertyValue('font-family').replace(/["']/g, '').trim(), weight: r.style.getPropertyValue('font-weight') || '400', style: r.style.getPropertyValue('font-style') || 'normal', urls })
        } else if (r.cssRules) walk(r.cssRules)
      } }
      walk(rules)
    }
    const root = getComputedStyle(document.documentElement)
    for (const name of [...root].filter((p) => p.startsWith('--'))) {
      const v = root.getPropertyValue(name).trim()
      if (v && CSS.supports('color', v) && !/^(inherit|initial|unset|currentcolor|transparent)$/i.test(v)) vars.push({ name, value: v })
    }
    // drop local() fallbacks (no url) and framework dev-overlay faces (e.g. Next's __nextjs-*)
    return { faces: faces.filter((f) => f.urls.length && !/^__/.test(f.family)), vars }
  })
  const out = {
    url: page.url(), fonts: sheets.faces, colorVars: sheets.vars,
    textStyles: [...styles.values()].sort((a, b) => parseFloat(b.size) - parseFloat(a.size) || b.count - a.count),
    colorsInUse: [...colors.values()].sort((a, b) => b.count - a.count),
  }
  fs.writeFileSync(process.env.OUT, JSON.stringify(out, null, 1))
  return { fonts: out.fonts.length, families: [...new Set(out.fonts.map((f) => f.family))], textStyles: out.textStyles.length, colorVars: out.colorVars.length, colorsInUse: out.colorsInUse.length }
}
