// Layer recipe template for scripts/browser/layers.js — patterns, not a site. Copy it into the project's _toolkit/, delete the sets
// you don't need, and fill every FILL_ME from map.js output and solo.js sheets.
//
// A recipe is { setName: { y, scene?, steps: [[label, code], ...] } }:
//   y      scroll position of the shot (layers.js travels there in steps, like a visitor)
//   scene  predicate picking the three.js scene, as a string: '(s, has, cnt) => bool'. Omit it for DOM-only sections.
//   steps  applied in order; each adds one layer. Step 1 strips everything, the last step restores the shipped frame.
// Step code runs with: s, k (scene children), cnt(o) (vertex count), has(o, f), inst (instanced meshes), O (original background/fog/visibility),
//   only(f) (hide all but camera + matches), show(f), uni(f) (uniform objects of matches), fx(regex, on), ui(on), css(selector, on).
//
// Selecting things — use whatever is stable in the map.js dump (construction order is not):
//   by name                (o) => o.name === 'FILL_ME'                       (object names often survive in GLB-loaded scenes)
//   by vertex count        (o) => cnt(o) === 12345                           (unique per mesh more often than you'd think)
//   by material type       (o) => o.material?.type === 'MeshStandardMaterial'
//   by shader uniform      (o) => !!o.material?.uniforms?.uFILL_ME          (custom shaders announce themselves)
//   by kind                (o) => o.isLight / o.isPoints / o.isSprite / o.isSkinnedMesh / o.isInstancedMesh
//   inside a group         (o) => o.isGroup && has(o, (c) => c.isSkinnedMesh)

const POST = '/Bloom|Chromatic|Vignette|Noise|Grain|Film|ToneMapping/' // effect names from map.js "passes"; adjust per project
const TYPE = null // e.g. '/TextureEffect/' when titles are a cached render target composited by an effect; null if text is ordinary meshes or DOM
const strip = `s.background = null; s.fog = null; fx(${POST}, 0); ${TYPE ? `fx(${TYPE}, 0);` : ''} ui(0)`
const finish = [
  ['Post', `fx(${POST}, 1)`],
  ...(TYPE ? [['Type', `fx(${TYPE}, 1)`]] : []),
  ['Interface', 'ui(1)'],
]

module.exports = {
  // 1. A 3D scene built up from its parts: subject first, then what surrounds it, then atmosphere, then the screen-space layers.
  hero_scene: {
    y: 0, // FILL_ME
    scene: "(s, has, cnt) => has(s, (o) => o.name === 'FILL_ME')",
    steps: [
      ['Subject', `only((o) => o.name === 'FILL_ME'); ${strip}`],
      ['Surroundings', "show((o) => o.isMesh && O.vis[k.indexOf(o)])"], // O.vis: never re-show what the site keeps hidden (debug helpers)
      ['Lights', 'show((o) => o.isLight)'],
      ['Background', 's.background = O.bg'],
      ['Atmosphere', 's.fog = O.fog; show((o) => (o.isPoints || o.isSprite) && O.vis[k.indexOf(o)])'],
      ['Everything else', 'k.forEach((o, i) => (o.visible = O.vis[i]))'], // anything the steps above missed, at its shipped visibility
      ...finish,
    ],
  },

  // 2. An instanced set: one step per instanced mesh, labelled with how many copies it draws (inst lists them; count = copies).
  instanced_set: {
    y: 0, // FILL_ME
    scene: '(s) => s.children.some((o) => o.isGroup && o.children.some((c) => c.isInstancedMesh))',
    steps: [
      ['Nothing', `only(() => false); ${strip}`],
      ['Instances A ×N', 'show((o) => o.isGroup && O.vis[k.indexOf(o)]); inst.forEach((m, i) => (m.visible = i === 0))'],
      ['Instances B ×N', 'inst.forEach((m, i) => i === 1 && (m.visible = true))'],
      ['All instances', 'inst.forEach((m) => (m.visible = true))'],
      ['Rest of the scene', 'k.forEach((o, i) => (o.visible = O.vis[i])); s.background = O.bg; s.fog = O.fog'],
      ...finish,
    ],
  },

  // 3. A custom shader taken apart: read the shader's uniforms, zero the ones that add an effect, then restore them one at a time.
  //    Rename uEffectA / uEffectB to the shader's real uniforms (read its fragment source) and add a step per ingredient.
  shader_ingredients: {
    y: 0, // FILL_ME
    scene: '(s, has) => has(s, (o) => !!o.material?.uniforms?.uFILL_ME)',
    steps: [
      ['Base', `only((o) => !!o.material?.uniforms?.uFILL_ME);
        window.__U0 = uni((o) => !!o.material?.uniforms?.uFILL_ME).map((u) => ({ a: u.uEffectA?.value, b: u.uEffectB?.value }));
        uni((o) => !!o.material?.uniforms?.uFILL_ME).forEach((u) => { if (u.uEffectA) u.uEffectA.value = 0; if (u.uEffectB) u.uEffectB.value = 0 });
        ${strip}`],
      ['+ Effect A', 'uni((o) => !!o.material?.uniforms?.uFILL_ME).forEach((u, i) => u.uEffectA && (u.uEffectA.value = __U0[i].a))'],
      ['+ Effect B', 'uni((o) => !!o.material?.uniforms?.uFILL_ME).forEach((u, i) => u.uEffectB && (u.uEffectB.value = __U0[i].b))'],
      ['Scene', 'k.forEach((o, i) => (o.visible = O.vis[i])); s.background = O.bg; s.fog = O.fog'],
      ...finish,
    ],
  },

  // 4. A DOM section (no `scene`): build the page up from the back. css(sel, true) forces visible even inside a hidden parent; css(sel) resets.
  dom_section: {
    y: 0, // FILL_ME
    steps: [
      ['Background media', "css('body *', false); css('video, canvas, picture, [class*=background]', true)"],
      ['Illustrations', "css('svg, img, [data-lottie], [class*=lottie]', true)"],
      ['Headlines', "css('h1, h2, h3', true)"],
      ['Copy', "css('p, li, blockquote', true)"],
      ['Interface', "css('body *')"],
    ],
  },
}
