# Offline renders with Blender

Purpose: views the site never shows. A 360° turntable of each chapter's set, plus clay → wire → bake stills that show the raw model under the
baked lighting. Optional extras: an isolated hero with alpha (ProRes 4444), a specimen sheet, a site-camera match.

## Setup
- Blender: `/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P script.py -- args`. EEVEE works headless on Apple silicon.
- Bundled library: `scripts/blender/common.py` (unlit site material, scene reset, camera helpers) and `chapters_lib.py` (stage materials
  clay/wire/bake with shared alpha clip, alpha-tested surface sampling for auto-framing, a seamless turntable camera whose distance breathes so the set
  fits at every angle, still + turntable output). Set `CS_SITE=<project>/public` and `CS_OUT=<output dir>`.
- Project-specific set builders go in a new `sets.py` (one function per set that imports the GLBs, assigns textures with
  `common.unlit_material`, and returns the objects to frame), with a tiny runner `render.py -- <set> probe|stills|turntable` on top of
  `chapters_lib`. If a previous case study left `<assets>/_toolkit/blender/`, start from its set builders.
- First inspect each GLB (objects, vertex counts, actions):
  ```python
  import bpy, sys
  for p in sys.argv[sys.argv.index('--')+1:]:
      bpy.ops.wm.read_factory_settings(use_empty=True); bpy.ops.import_scene.gltf(filepath=p); print('==', p)
      for o in bpy.data.objects: print(' ', o.type, o.name, len(o.data.vertices) if o.type == 'MESH' else '', tuple(round(d, 1) for d in o.dimensions))
      for a in bpy.data.actions: print('  action', a.name, a.frame_range[:])
  ```
- Map each GLB mesh to its textures by reading the project's scene components (`useGLTF(...)`, texture loaders, `map`/`alphaMap`).
  Prefer the full-resolution PNG next to each KTX2.

## Delegate it
Blender work is long, independent and parallel to browser capture, so give it to a background subagent. Brief template:

```
You are producing offline renders for a design-agency case study of <PROJECT> (<one-line description>). Reuse the bundled library:
<SKILL>/scripts/blender/common.py and chapters_lib.py (read them first); write one set-builder function per set in a sets.py. Write scripts to <WORK>/blender-scripts/ and outputs to <WORK>/out/blender/<set>/. Do NOT modify <PROJECT_ROOT>.
Env: CS_SITE=<PROJECT_ROOT>/public CS_OUT=<WORK>/out/blender/
Material rule: Emission strength 1 from the baked sRGB texture, alpha map hard-clipped at 0.25 (blend Clip), view transform Standard,
background <BG_HEX> plus transparent PNG variants. Everything 1920x1080 (16:9).
Sets (for each: turntable_360.mp4, 8 s 24 fps seamless, H.264 crf 18, and stills 01_clay, 02_wire, 03_bake from one hero 3/4 camera, _dark.png + transparent .png):
  <set name>: <GLB paths + meshes + textures/alpha maps>, <notes: animation to loop, instances JSON to rebuild, fog colour for dark bakes>
Check one probe frame per set with the Read tool before rendering sequences. Keep each job under ~10 min.
Final report: every output path, what it shows, honest quality notes, and asset facts useful for a case study (verts/tris, texture sizes,
compression ratios, anything surprising).
```

Tell it about runtime-only data the GLBs don't hold: instance matrices from `instances.js`, live uniform values (fog colour, grid
colour/scale) from `map.js`, and animation timing. Ask it for `_fogbg` variants when bakes are dark.

## After it reports
Read its overview or contact sheet yourself before using anything. Copy the mp4s and PNGs into the chapter folders (`blender/` subfolder).
Leave out raw PNG turntable frames unless asked; they run to GBs.
