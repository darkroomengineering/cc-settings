// 16:9 colour and typography sheets, set in the project's own fonts, rendered by the capture Chrome.
// usage: OUT=dir node cdp.js specimens.js <tokens.json> [design.json]
// tokens.json comes from tokens.js (what the live site uses). design.json is optional, curated from the source when it has named
// tokens (see the skill's examples/design-template.json); anything it leaves out falls back to tokens.json.
// Typefaces and styles may carry `variation` / `features` (CSS font-variation-settings / font-feature-settings), e.g. a condensed width axis.
// Writes: colors_palette.png, colors_<group>.png (themes / modes), type_<family>.png per typeface, type_scale.png, type_in_use.png.
const fs = require('node:fs'), path = require('node:path')
const MIME = { woff2: 'font/woff2', woff: 'font/woff', ttf: 'font/ttf', otf: 'font/otf' }
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])
// CSS values from getComputedStyle quote axis tags with " (e.g. "wdth" 75), which would end an inline style attribute
const q = (v) => (v && v !== 'normal' ? String(v).replace(/"/g, "'") : 'normal')
// Font names and colours come from the audited page and land in <style> and style attributes: keep only characters a name or value needs
const fam = (s) => String(s).replace(/[^\p{L}\p{N} _.-]/gu, '')
const cssv = (s) => String(s).replace(/[^\w #(),.%/-]/g, '')
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '')

function toHex(c) {
  if (/^#[0-9a-f]{3,8}$/i.test(c)) return c.length === 4 ? '#' + [...c.slice(1)].map((x) => x + x).join('') : c.slice(0, 7)
  const m = String(c).match(/rgba?\(([^)]+)\)/); if (!m) return cssv(c)
  const [r, g, b] = m[1].split(/[ ,/]+/).map(Number)
  return '#' + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')
}
const rgb = (hex) => { const n = parseInt(hex.slice(1, 7), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255] }
const lum = (hex) => { const [r, g, b] = rgb(hex).map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4 }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }

// A CDN locked to the site's origin answers 403 without its Origin and Referer, and an error page must not pass as a font
async function fontData(src, site) {
  const ext = (src.split('?')[0].split('.').pop() || 'woff2').toLowerCase()
  let buf
  if (/^https?:/.test(src)) {
    const res = await fetch(src, { headers: { origin: new URL(site).origin, referer: site } })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    buf = Buffer.from(await res.arrayBuffer())
  } else buf = fs.readFileSync(src)
  return `data:${MIME[ext] || 'font/woff2'};base64,${buf.toString('base64')}`
}

module.exports = async (page, tokensPath, designPath) => {
  const T = JSON.parse(fs.readFileSync(tokensPath, 'utf8'))
  const D = designPath ? JSON.parse(fs.readFileSync(designPath, 'utf8')) : {}
  const bg = D.background || '#0b0b0c', ink = D.ink || '#f2f0ec', accent = D.accent || ink, name = D.name || new URL(T.url).hostname
  // fonts: curated local files first, then the live site's @font-face sources
  const files = {}
  for (const [k, list] of Object.entries(D.fontFiles || {})) files[fam(k)] = list.map((f) => ({ ...f, src: f.path }))
  for (const f of T.fonts || []) if (!D.fontFiles?.[f.family] && f.urls[0]) (files[fam(f.family)] ||= []).push({ weight: f.weight, style: f.style, src: f.urls.find((u) => /woff2/.test(u)) || f.urls[0] })
  let faceCss = ''
  for (const [family, list] of Object.entries(files)) for (const f of list) {
    try { faceCss += `@font-face{font-family:"${family}";src:url(${await fontData(f.src, T.url)});font-weight:${cssv(f.weight || 400)};font-style:${cssv(f.style || 'normal')}}\n` } catch (e) { console.error('font not embedded, the sheet falls back to a system font:', family, f.src, e.message) }
  }
  const families = Object.keys(files)
  const label = fam(D.labelFont || families.find((f) => /mono/i.test(f)) || 'ui-monospace')
  const base = `<style>${faceCss}*{box-sizing:border-box;margin:0}html,body{width:1920px;height:1080px;background:${bg};color:${ink};overflow:hidden}
    body{padding:96px 112px;display:flex;flex-direction:column;gap:48px;font-family:"${families[0] || 'system-ui'}",system-ui}
    .lab{font-family:"${label}",ui-monospace,Menlo,monospace;font-size:15px;letter-spacing:.06em;text-transform:uppercase;opacity:.62}
    .head{display:flex;justify-content:space-between;align-items:baseline}.head .t{font-size:44px;letter-spacing:-.02em}</style>`
  const sheet = (title, body) => `<!doctype html><html><head><meta charset="utf-8">${base}</head><body><div class="head"><div class="t">${esc(title)}</div><div class="lab">${esc(name)}</div></div>${body}</body></html>`

  const p = await page.browser().newPage()
  await p.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  const shoot = async (file, html) => { await p.setContent(html, { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready); await new Promise((r) => setTimeout(r, 300)); await p.screenshot({ path: path.join(process.env.OUT, file) }); return file }
  fs.mkdirSync(process.env.OUT, { recursive: true })
  const made = []

  // colours
  const palette = D.palette || (T.colorVars?.length ? T.colorVars.map((v) => ({ name: v.name.replace(/^--/, ''), hex: toHex(v.value) }))
    : [...new Map((T.colorsInUse || []).map((c) => [toHex(c.value), { name: `${c.count}× in use`, hex: toHex(c.value) }])).values()].slice(0, 16))
  const swatches = (list, h) => list.map((c) => {
    const on = lum(c.hex) > 0.4 ? '#111' : '#fff'
    return `<div style="background:${c.hex};color:${on};height:${h}px;padding:22px 24px;display:flex;flex-direction:column;justify-content:space-between;border-radius:4px;outline:1px solid rgba(127,127,127,.25)">
      <div style="font-size:24px">${esc(c.name)}</div><div class="lab" style="opacity:.85">${c.hex.toUpperCase()} · ${rgb(c.hex).join(' ')}</div></div>`
  }).join('')
  const cols = Math.min(6, Math.max(3, Math.ceil(Math.sqrt(palette.length * 1.8))))
  const rows = Math.ceil(palette.length / cols)
  made.push(await shoot('colors_palette.png', sheet('Colour palette', `<div style="display:grid;grid-template-columns:repeat(${cols},1fr);gap:16px">${swatches(palette, Math.min(300, Math.floor((780 - (rows - 1) * 16) / rows)))}</div>`)))
  for (const g of D.groups || []) {
    made.push(await shoot(`colors_${slug(g.name)}.png`, sheet(`${g.name}`, `${g.note ? `<div class="lab">${esc(g.note)}</div>` : ''}<div style="display:grid;grid-template-columns:repeat(${Math.min(6, g.colors.length)},1fr);gap:16px;flex:1">${swatches(g.colors, 640)}</div>`)))
  }

  // typefaces
  const faces = D.typefaces || families.map((f) => ({ family: f, weights: [...new Set((files[f] || []).map((x) => +x.weight || 400))].sort((a, b) => a - b) }))
  const siteSample = (T.textStyles || []).find((s) => s.sample.length > 30)?.sample
  for (const f of faces) {
    const weights = f.weights?.length ? f.weights : [400]
    made.push(await shoot(`type_${slug(f.family)}.png`, sheet(`${f.family}${f.role ? ' — ' + f.role : ''}`, `
      <div style="display:grid;grid-template-columns:640px 1fr;gap:64px;flex:1;font-family:'${fam(f.family)}';font-variation-settings:${q(f.variation)}">
        <div style="font-size:400px;line-height:.9;letter-spacing:-.02em;color:${accent}">Aa</div>
        <div style="display:flex;flex-direction:column;gap:22px;min-width:0">
          <div style="font-size:52px;line-height:1.1;word-break:break-all">ABCDEFGHIJKLM NOPQRSTUVWXYZ</div>
          <div style="font-size:52px;line-height:1.1;word-break:break-all">abcdefghijklm nopqrstuvwxyz</div>
          <div style="font-size:52px;line-height:1.1">0123456789 &amp;@#!?%€$*()</div>
          ${weights.map((w) => `<div style="display:flex;gap:24px;align-items:baseline"><span class="lab" style="width:90px;flex:none">${w}</span><span style="font-weight:${w};font-size:34px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(f.sample || siteSample || 'The quick brown fox jumps over the lazy dog')}</span></div>`).join('')}
        </div></div>`)))
  }

  // type scale (curated) and styles in use (live)
  const r1 = (v) => String(v).replace(/(-?\d+\.\d+)(px|em)?/g, (_, n, u = '') => (+(+n).toFixed(u === 'em' ? 3 : 1)) + u) // 16.6667px -> 16.7px
  const row = (s) => `<div style="display:grid;grid-template-columns:420px 1fr;gap:40px;align-items:baseline;border-top:1px solid rgba(127,127,127,.25);padding-top:14px">
    <div class="lab" style="line-height:1.6">${esc(s.name)}<br>${esc(s.family)} · ${esc(r1(s.size))} / ${esc(r1(s.lineHeight))} · ${esc(r1(s.letterSpacing))} · ${esc(s.weight)}${s.transform && s.transform !== 'none' ? ' · ' + esc(s.transform) : ''}${s.variation && s.variation !== 'normal' ? ' · ' + esc(s.variation.replace(/'/g, '')) : ''}${s.count ? ' · ' + s.count + '×' : ''}</div>
    <div style="font-family:'${fam(s.family)}';font-size:${/^\d+(\.\d+)?$/.test(String(s.size)) ? s.size + 'px' : s.size};line-height:${s.lineHeight === 'normal' ? 'normal' : s.lineHeight};letter-spacing:${s.letterSpacing === 'normal' ? 'normal' : s.letterSpacing};font-weight:${s.weight};text-transform:${s.transform || 'none'};font-variation-settings:${q(s.variation)};font-feature-settings:${q(s.features)};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:0">${esc(s.sample || siteSample || 'Typography')}</div></div>`
  if (D.styles?.length) made.push(await shoot('type_scale.png', sheet('Type scale', `<div style="display:flex;flex-direction:column;gap:18px">${D.styles.map(row).join('')}</div>`)))
  const inUse = (T.textStyles || []).filter((s, i, a) => a.findIndex((x) => x.fam === s.fam && x.size === s.size && x.weight === s.weight) === i).slice(0, 9)
    .map((s) => ({ name: `<${s.tag}>`, family: s.fam, size: s.size, lineHeight: s.lineHeight, letterSpacing: s.letterSpacing, weight: s.weight, transform: s.transform, variation: s.variation, features: s.features, sample: s.sample, count: s.count }))
  if (inUse.length) made.push(await shoot('type_in_use.png', sheet('Text styles on the live site', `<div style="display:flex;flex-direction:column;gap:14px">${inUse.map(row).join('')}</div>`)))
  await p.close()
  return made
}
