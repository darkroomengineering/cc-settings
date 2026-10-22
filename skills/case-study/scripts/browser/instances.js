// Export every InstancedMesh of a scene (matrixWorld + per-instance matrices, three.js Y-up, column-major) and the scene camera,
// so Blender can rebuild what the site actually places at runtime. usage: OUT=file.json node cdp.js instances.js "<scene pred>"
const { prelude } = require('./prelude.js')
module.exports = async (page, pred) => {
  await page.evaluate(prelude)
  const data = await page.evaluate(`(() => {
    const s = __H.pick(${pred}), out = { note: 'three.js world space, Y up. world = matrixWorld x instance (column-major 4x4).', meshes: [] }
    s.traverse((o) => { if (o.isInstancedMesh) { o.updateMatrixWorld(true); out.meshes.push({ name: o.name || o.geometry.name || '', vertices: __H.cnt(o), count: o.count, matrixWorld: o.matrixWorld.elements,
      instances: Array.from({ length: o.count }, (_, i) => Array.from(o.instanceMatrix.array.slice(i * 16, i * 16 + 16)).map((n) => +n.toFixed(5))) }) } })
    const cam = s.children.find((c) => c.isCamera); out.camera = { position: cam.position.toArray(), quaternion: cam.quaternion.toArray(), fov: cam.fov, near: cam.near, far: cam.far, scrollY }
    return out
  })()`)
  require('node:fs').writeFileSync(process.env.OUT, JSON.stringify(data))
  return data.meshes.map((m) => `${m.name || 'v' + m.vertices} ×${m.count}`)
}
