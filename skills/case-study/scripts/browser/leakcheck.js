// Leak check for the fake data layer: finds any real value from map.json (its "text" keys and "patterns") in what a case study ships.
// A leak cannot be undone once the case study is public, so it exits non-zero and every output it names must be redone before export.
// live page:  node cdp.js leakcheck.js <map.json>           page text, form values and the alt / title / aria-label / placeholder / href
//                                                           attributes, in every same-origin frame; run it after boot and before each take
// files:      node leakcheck.js <map.json> <dir|file> …    text files (json, html, js, css, md, txt, svg, csv) are searched as text; images
//                                                           (png, jpg, webp) are read with tesseract OCR, one frame in OCR_EVERY (default 30)
//                                                           of each numbered frame folder; videos are skipped: check their frame folders
// exit 0: clean.  exit 1: a real value was found.  exit 2: something could not be checked (no tesseract): not a pass.
// OCR misreads small or stylised type, so a clean OCR run is evidence, not proof: check the live page before every take as well.
const fs = require('node:fs'), path = require('node:path'), { execFileSync } = require('node:child_process')
const load = (file) => {
  const map = JSON.parse(fs.readFileSync(file, 'utf8'))
  return { values: Object.keys(map.text || {}), patterns: (map.patterns || []).map((p) => p.match) }
}
// matches ignore case and runs of whitespace, so "Jane  Doe" in a layout and "JANE DOE" in a title still count
const finder = ({ values, patterns }) => {
  const norm = (s) => s.replace(/\s+/g, ' ').toLowerCase()
  const vals = values.map((v) => [v, norm(v)])
  const res = patterns.map((p) => new RegExp(p, 'gi'))
  return (text) => {
    const t = norm(text), hits = new Set()
    for (const [v, n] of vals) if (n && t.includes(n)) hits.add(v)
    for (const re of res) for (const m of text.matchAll(re)) hits.add(m[0])
    return [...hits]
  }
}

module.exports = async (page, mapFile) => {
  const find = finder(load(mapFile))
  const texts = await page.evaluate(() => {
    const out = [], ATTRS = ['alt', 'title', 'aria-label', 'placeholder', 'href', 'value', 'content']
    const walk = (doc, where) => {
      out.push([where, doc.body?.innerText || ''])
      doc.querySelectorAll('input, textarea, select').forEach((e) => out.push([`${where} ${e.tagName.toLowerCase()} value`, e.value || '']))
      doc.querySelectorAll('*').forEach((e) => ATTRS.forEach((a) => e.hasAttribute(a) && out.push([`${where} <${e.tagName.toLowerCase()} ${a}>`, e.getAttribute(a)])))
      out.push([`${where} title`, doc.title])
      doc.querySelectorAll('iframe').forEach((f, i) => { try { if (f.contentDocument) walk(f.contentDocument, `${where} iframe ${i}`) } catch {} })
    }
    walk(document, 'page')
    return out
  })
  const leaks = texts.flatMap(([where, t]) => find(t).map((value) => ({ where, value })))
  if (leaks.length) throw new Error(`LEAK: ${leaks.length} real value(s) on the live page:\n${leaks.map((l) => `  ${l.value}  (${l.where})`).join('\n')}`)
  return { leaks: 0, checked: texts.length }
}

if (require.main === module) {
  const [mapFile, ...targets] = process.argv.slice(2)
  if (!mapFile || !targets.length) { console.error('usage: node leakcheck.js <map.json> <dir|file> …'); process.exit(1) }
  const find = finder(load(mapFile)), every = +(process.env.OCR_EVERY || 30)
  const TEXT = /\.(json|html?|m?js|css|md|txt|svg|csv|tsv|xml|vtt|srt)$/i, IMG = /\.(png|jpe?g|webp)$/i
  let ocr = true
  try { execFileSync('tesseract', ['--version'], { stdio: 'ignore' }) } catch { ocr = false }
  const leaks = [], unchecked = []
  let files = 0, images = 0
  const visit = (p) => {
    const st = fs.statSync(p)
    if (st.isDirectory()) {
      const names = fs.readdirSync(p).filter((n) => !n.startsWith('.')).sort()
      // a numbered frame folder (f_00000.jpg …) gets sampled; any other image is read in full
      const frames = names.filter((n) => /^f_\d+\.(jpe?g|png)$/i.test(n))
      const keep = new Set(frames.filter((_, i) => i % every === 0 || i === frames.length - 1))
      for (const n of names) if (!frames.includes(n) || keep.has(n)) visit(path.join(p, n))
      return
    }
    if (path.resolve(p) === path.resolve(mapFile)) return
    if (TEXT.test(p)) { files++; find(fs.readFileSync(p, 'utf8')).forEach((value) => leaks.push({ file: p, value })); return }
    if (!IMG.test(p)) return
    if (!ocr) { unchecked.push(p); return }
    images++
    const text = execFileSync('tesseract', [p, '-', '--psm', '11'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })
    find(text).forEach((value) => leaks.push({ file: p, value }))
  }
  targets.forEach(visit)
  for (const l of leaks) console.log(`LEAK  ${l.value}  ${l.file}`)
  console.log(`checked ${files} text files and ${images} images (OCR, 1 frame in ${every} of each frame folder)`)
  if (leaks.length) { console.log(`${leaks.length} leak(s): redo these outputs with fakedata.js running, then check again`); process.exit(1) }
  if (unchecked.length) { console.log(`${unchecked.length} images NOT checked: install tesseract (brew install tesseract) and run again`); process.exit(2) }
  console.log('no real values found')
}
