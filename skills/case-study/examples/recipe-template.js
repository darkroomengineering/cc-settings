// Layer recipe template for scripts/browser/layers.js. One entry per set (a chapter, or one camera position of a chapter).
// Find `y` with map.js + screenshots, write `scene` from a feature unique to that scene (a vertex count, a uniform name, a SkinnedMesh),
// and run solo.js at `y` first so every step below adds something the camera actually sees.
// Step code runs with: s, k, cnt, has, inst, O, only(f), show(f), uni(f), fx(re, on), ui(on) — see layers.js.
const LENS = '/Chromatic|Vignette|Noise|Bloom/' // postprocessing effect names from map.js
const TYPE = '/TextureEffect/' // if titles are a cached render target composited by an effect; otherwise hide the text meshes
const start = `s.background = null; s.fog = null; fx(${LENS}, 0); fx(${TYPE}, 0); ui(0)`
const finish = [['Lens', `fx(${LENS}, 1)`], ['Type', `fx(${TYPE}, 1)`], ['Interface', 'ui(1)']]

module.exports = {
  ch1_landscape: {
    y: 900,
    scene: '(s, has, cnt) => has(s, (o) => cnt(o) === 120000)', // e.g. the terrain mesh's vertex count
    steps: [
      ['Raw bake', `only((o) => cnt(o) === 120000); ${start}`],
      ['Sky', 's.background = O.bg'],
      ['Water', "show((o) => o.material?.type === 'MeshStandardMaterial' || o.isLight)"],
      ['Clouds', 'show((o) => !!o.material?.uniforms?.uCloudNoise)'], // a uniform only the cloud shader has
      ['Fog', 's.fog = O.fog'],
      ...finish,
    ],
  },
  ch2_forest: {
    y: 9000,
    scene: '(s) => s.children.some((o) => o.isGroup && o.children.some((c) => c.isInstancedMesh))',
    steps: [
      // instanced sets: reveal species by vertex count, and say how many copies each draws
      ['Ground tiles ×N', `only((o) => o.isGroup && O.vis[k.indexOf(o)]); inst.forEach((m) => (m.visible = cnt(m) === 900)); ${start}`],
      ['Tall trees ×N', 'inst.forEach((m) => cnt(m) === 8000 && (m.visible = true))'],
      ['Undergrowth', 'inst.forEach((m) => (m.visible = true))'],
      ['Fog', 's.background = O.bg; s.fog = O.fog'],
      ...finish,
    ],
  },
  ch4_grid: {
    y: 23000,
    scene: '(s, has) => has(s, (o) => o.material?.uniforms?.uGridScale)',
    steps: [
      // shader ingredients: read originals first, zero them, then restore one at a time
      ['Terrain', `only((o) => !!o.material?.uniforms?.uGridScale); window.__T0 = uni((o) => o.material?.uniforms?.uGridScale).map((u) => u.uGridThickness.value); uni((o) => o.material?.uniforms?.uGridScale).forEach((u) => (u.uGridThickness.value = 0)); ${start}`],
      ['Grid', 'uni((o) => o.material?.uniforms?.uGridScale).forEach((u, i) => (u.uGridThickness.value = __T0[i]))'],
      ['Sky', 's.background = O.bg'],
      ['Fog', 's.fog = O.fog'],
      ...finish,
    ],
  },
}
