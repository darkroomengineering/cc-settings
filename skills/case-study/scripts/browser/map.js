// Dump every non-trivial scene graph (types, vertex counts, material uniforms, instancing, visibility),
// the postprocessing passes, and tall DOM sections with their scroll offsets. First thing to run on a new site.
// usage: node cdp.js map.js [scrollPositions comma-separated, visited first so lazy chapters load]
const { prelude } = require('./prelude.js')
const { goTo } = require('./goto.js')
module.exports = async (page, ys = '') => {
  await page.setViewport({ width: 1920, height: 1080, deviceScaleFactor: 1 })
  for (const y of ys.split(',').filter(Boolean)) await goTo(page, y)
  await page.evaluate(prelude)
  return page.evaluate(() => {
    const d = (o, n = 0) => {
      const v = __H.cnt(o), m = o.material, u = m?.uniforms ? Object.keys(m.uniforms).filter((k) => !/^uTroika/.test(k)).slice(0, 8).join(',') : ''
      let s = `${'  '.repeat(n)}${o.type}${o.name ? ' "' + o.name + '"' : ''}${v ? ' v=' + v : ''}${m ? ' ' + m.type : ''}${u ? ' {' + u + '}' : ''}${m?.map?.image?.width ? ' map' + m.map.image.width : ''}${o.isInstancedMesh ? ' ×' + o.count : ''}${o.visible ? '' : ' HIDDEN'}`
      if (n < 8 && o.children.length && o.children.length < 20) s += '\n' + o.children.map((c) => d(c, n + 1)).join('\n') // R3F nests deep
      else if (o.children.length) s += ` [${o.children.length} children]`
      return s
    }
    const sections = [...document.querySelectorAll('section, main > *, [class*=chapter], [class*=section]')].filter((n) => n.offsetHeight > innerHeight * 0.8).map((n) => `${n.tagName}.${String(n.className).split(' ')[0].slice(0, 40)} top=${Math.round(n.getBoundingClientRect().top + scrollY)} h=${n.offsetHeight}`)
    const dom = [...document.querySelectorAll('canvas, video, svg, img, [class*=lottie], [data-lottie]')].filter((n) => n.getBoundingClientRect().width > 200).slice(0, 30).map((n) => `${n.tagName}.${String(n.className?.baseVal ?? n.className).split(' ')[0].slice(0, 40)} ${Math.round(n.getBoundingClientRect().width)}x${Math.round(n.getBoundingClientRect().height)} top=${Math.round(n.getBoundingClientRect().top + scrollY)}`)
    return { dom, scenes: __big.map((s, i) => `#${i} background=${s.background?.isColor ? '#' + s.background.getHexString() : typeof s.background} fog=${!!s.fog}\n${d(s)}`).join('\n'), passes: __cap.passes.map((p) => (p.effects || []).map((e) => e.name).join('+')).filter((v, i, a) => a.indexOf(v) === i), sections: [...new Set(sections)], scrollHeight: document.documentElement.scrollHeight }
  })
}
