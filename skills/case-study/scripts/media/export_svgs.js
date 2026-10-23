// Every SVG as its own files: original .svg, transparent PNG (longest side 2048), PNG on a dark ground. Grouped by filename.
// usage: node export_svgs.js <svg_dir> <out_dir> <project_root_with_sharp_in_node_modules> [bg=#080a07] [ink=#ffffff]
// ink: the colour `currentColor` resolves to (icons that inherit the page's text colour would otherwise export black)
const [src, out, root, bg = '#080a07', ink = '#ffffff'] = process.argv.slice(2)
const sharp = require(require.resolve('sharp', { paths: [root, process.cwd()] })), fs = require('node:fs'), path = require('node:path')
const groups = { glyphs: /glyph|badge|icon/i, logos: /logo|favicon|wordmark|logotype/i, frames: /frame|border|delimiter|circle|corner/i, ui: /./ }
const jobs = []
for (const f of fs.readdirSync(src).filter((f) => f.endsWith('.svg')).sort()) {
  let svg = fs.readFileSync(path.join(src, f), 'utf8')
  if (!svg.includes('xmlns=')) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"') // SVGR sources often omit it; librsvg needs it
  const raster = /currentColor/i.test(svg) ? svg.replace('<svg', `<svg color="${ink}"`) : svg // the .svg itself is kept as shipped
  const g = Object.keys(groups).find((k) => groups[k].test(f)), dir = path.join(out, g); fs.mkdirSync(dir, { recursive: true })
  const name = f.replace('.svg', ''); fs.writeFileSync(path.join(dir, f), svg)
  const vb = svg.match(/viewBox="([^"]+)"/)?.[1]; const [, , w, h] = (vb || `0 0 ${svg.match(/width="(\d+)/)?.[1] || 100} ${svg.match(/height="(\d+)/)?.[1] || 100}`).split(/[\s,]+/).map(Number)
  const scale = 2048 / Math.max(w, h)
  jobs.push(sharp(Buffer.from(raster), { density: Math.min(72 * scale, 20000) }).resize({ width: Math.round(w * scale), height: Math.round(h * scale), fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } }).png().toFile(path.join(dir, name + '.png'))
    .then(() => sharp(path.join(dir, name + '.png')).flatten({ background: bg }).extend({ top: 256, bottom: 256, left: 256, right: 256, background: bg }).png().toFile(path.join(dir, name + '_on_dark.png')))
    .then(() => console.log(g, name, `${w}x${h}`)).catch((e) => { console.error(f, e.message); return f }))
}
Promise.all(jobs).then((r) => { const failed = r.filter(Boolean); if (failed.length) { console.error(`${failed.length} SVG(s) failed: ${failed.join(', ')}`); process.exit(1) } })
