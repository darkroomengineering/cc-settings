---
name: case-study
description: Turn any web project (WebGL, three.js, React Three Fiber, Theatre.js, GSAP or Lenis scroll sites, and plain DOM sites) into case-study material for the studio website. Produces frame-perfect 16:9 clips of every chapter and transition, layer-by-layer decompositions of every scene, Blender turntables and clay/wire/bake renders, every sound exported separately with mixes rebuilt from the animation data, every image asset (glyphs, logos, frames, textures) exported separately, and a shareable exploration board. Triggers "case study", "showcase", "portfolio piece", "making-of", "breakdown", "how it's made", "decompose the scene", "take apart the landscape", "record the site", "capture footage", "turntable", "export the sounds", "extract the icons/assets". Use when a finished project needs to be shown, even if nobody says "case study".
requires:
  - command: ffmpeg
    install: "brew install ffmpeg (encoding, contact sheets, sound export)"
  - command: node
    install: "Node 18+ (puppeteer-core capture rig; run npm i --prefix scripts/browser puppeteer-core once)"
---

# Case study from a project

The goal is raw material a designer can build a case study from: many separate, clean, 16:9 videos and images that show **how the work
is made**, not one showreel. Everything comes from the project itself: the live site rendered by its own code, its own GLB models and
bakes, its own stems and SVGs. Nothing is invented, and each item says how it was made.

## What the user expects (learned the hard way)
- **16:9, 1920×1080 masters for everything**, including stills, grids and Blender renders. Re-render instead of cropping.
- **A list of separate videos and images, never just one film.** Cut long captures into per-chapter and per-transition clips, plus stills.
- **Every chapter gets the same depth.** Each one is decomposed layer by layer and gets a 3D turntable. Don't stop at the most obvious scene.
- **Every sound and every image asset as its own file**, including small UI glyphs such as a navigation rail's icons.
- **The repo stays clean.** No commits. Revert lockfile or config churn caused by installs and dev servers.
- Show progress with contact sheets, and look at every capture (Read the image) before using it.

## Output layout
Masters go next to the project: `<parent of project>/<project>-case-study-assets/`. Working files go in the session scratchpad (`<WORK>`).
```
01_film/            video/: 00_full_scroll.mp4 + one clip per chapter & transition    stills/: ~24 frames
02_ch1_<name>/      stills/layer_NN_<label>.png   video/layer_build_live.mp4, hero shots   blender/ turntable + clay/wire/bake
03_ch2_<name>/ ...  (one folder per chapter, numbered in site order)
NN_transitions/     anatomy grid + labelled sequence + per-stage clips & stills
NN_type/            reveal on black, cursor response, stills
NN_sound/           stems_original/ stems_normalized/ stills_per_sound/ clip_soundtracks/ mixes/
NN_image_assets/    svg/<glyphs|logos|frames|ui>/ (svg + 2048 png + png on dark), glyph sheet 16:9, textures/<scene>/
_toolkit/           this project's recipes, capture scripts, Blender sets, board source (kept private, next to the masters)
```
Project-specific code (recipes, shader names, board copy) belongs in `_toolkit/`, never in this skill. Before starting, look for a previous
`*-case-study-assets/_toolkit/` to reuse.

## Workflow

Run the phases in order. Run Blender (phase 5) as a background subagent as soon as phase 1 has found the models, so it renders while you
capture. Before starting, read `references/gotchas.md`: each item there cost hours once.

### 1. Recon (10 min)
- **Stack:** read `package.json` (three, @react-three/fiber, postprocessing, @theatre/core, gsap, lenis, howler, troika).
- **Assets:** list `public/` (models `*.glb`, textures PNG/KTX2, sounds + sprite JSON, fonts, `config/*.json` Theatre states) and SVG folders.
- **Structure:** read the page and chapter components to learn scene order, chapter names, what each scene loads, the transition shader, the
  text system and the sound triggers (`grep -rn "play(\|Sfx_\|howl" app components`).
- **Production URL:** find it (grep for the domain, or ask). Then decide where to capture from: run the local dev server and production
  side by side in the rig and compare. Prefer whichever renders correctly and matches what shipped. Usually that's production.
- **Tools:** `ffmpeg`, Blender.app, Chrome, and puppeteer-core installed once with `npm i --prefix <SKILL>/scripts/browser puppeteer-core`.

### 2. Browser rig
```
<SKILL>/scripts/browser/chrome.sh <WORK>/chrome-profile        # run_in_background; headless, real GPU, 1920x1080
cd <SKILL>/scripts/browser && node cdp.js boot.js <url> [gateX,gateY]   # fresh load + hook.js; click a sound/enter gate if any
```
`hook.js` is injected before the page's own scripts. It grabs every three.js Scene, the renderer and the postprocessing EffectPasses as they
are constructed (no source edits, works on minified production), and installs a **virtual clock**: `__vt.start()` freezes rAF,
`performance.now`, `Date.now`, CSS animations and `<video>`, then `__vt.step(ms)` advances exactly one frame. `rec.js` steps it 1/60 s per
screenshot, so captures are frame-perfect at any resolution and identical on every run, with no dropped frames. All tasks run as
`node cdp.js <task.js> args…`, with output folders set by the `OUT` env var.

### 3. Map the site
- `node cdp.js map.js <y1,y2,…>` visits those scroll positions (so lazy chapters load), then prints every scene graph with vertex counts, material
  uniforms, instancing and visibility, the postprocessing chain, and tall DOM sections with their scroll offsets.
- Identify each chapter's scene by a stable feature, such as a unique vertex count, a uniform name or a SkinnedMesh. Construction order changes on every load.
- Pick a hero scroll position per chapter: screenshot a few candidates, and project the subject to screen space if there is one.
- **For each hero position, run `solo.js <y> "<scene pred>"` and look at the result before writing that chapter's recipe.** It shows what the
  camera really sees: off-frame sets, instances doing the work, hidden debug helpers.

### 4. Captures (each from a fresh `boot.js`)
- **Film:** `film.js 0 <end> <seconds>` (as shipped, linear scroll), encoded with `media/frames2mp4.sh`. Then cut it into per-chapter and
  per-transition clips plus ~24 stills with `media/cut_film.sh` (clips file: `name|start|end`). Find boundaries from section offsets and a contact sheet.
- **Layer decomposition per chapter:** write a recipe (`examples/recipe-template.js`; helpers are documented in `layers.js`), then
  `OUT=… node cdp.js layers.js recipes.js <set> 1.25`. That gives stills `NN_label.png` plus a live build video (one layer every 1.25 s, with the scene still
  animating). Typical order: raw geometry/bake → sky → each mesh family (name instance counts) → atmosphere (clouds, mist, fog, rain) →
  lens effects (`fx(/Chromatic|Vignette|Noise|Bloom/)`) → type layer → `ui(1)` interface. Wrap the captures in a retry loop, because tabs die under memory pressure.
- **Hero subjects** (characters, products): `hold.js <y> <s>` for a clean hold, or with a target predicate and zoom for a push-in
  (`setViewOffset`, which stays sharp). To time foley to a motion (a head shake), log a bone's quaternion per frame in `perFrame` and find the angular-velocity peak.
- **Transitions:** freeze mid-transition, take over the shader's progress uniform, and switch its ingredients on one by one. Include the shader's
  debug mode if it has one. Deliver a 3×3 16:9 grid plus a labelled sequence (`examples/transition-anatomy.js`; tile with ffmpeg `xstack` into 640×360 cells).
- **Type:** titles alone on black, by pinning the scene inputs black (`examples/type-on-black.js`), plus a scripted cursor pass if the type reacts to the pointer.
- **Interactions:** `click.js <y> 7 0.6` for click-triggered moments (scans, reveals). Lay the matching sound at the click time.
- Check every capture with `media/sheet.sh` + Read before moving on.

### 5. Blender (delegate early)
Follow `references/blender.md`. In short: a background subagent renders, per chapter set, a seamless 360° turntable plus clay/wire/bake
stills from the GLBs and baked textures, using the bundled `scripts/blender` library. Feed it runtime-only facts from the rig: instance
matrices (`instances.js`), live uniform values such as fog and grid colours, and animation loops. Review its overview sheet when it reports.

### 6. Sound
- `media/export_sounds.sh <sounds_dir> <out>/NN_sound <accent> <bg> <font>` exports, for every sound, the original file, a copy normalized to −1 dB peak,
  a 16:9 waveform and a spectrogram.
- If the volumes are keyframed (Theatre `sounds` objects, GSAP timelines), rebuild the real mix for each capture's scroll path with
  `media/soundtrack.py` (spec documented in the file; example in `examples/soundtrack-spec.json`). Add one-shots where the
  code fires them: loop events, click times, progress windows. Mux the result onto each clip, and export each clip's soundtrack as its own WAV.

### 7. Image assets
- `node media/export_svgs.js <svg_dir> <out>/NN_image_assets/svg <project_root>` (uses the project's `sharp`): each SVG as svg + 2048 px
  transparent PNG + PNG on dark, grouped into glyphs / logos / frames / ui. Then add a 16:9 sheet of the glyphs.
- Copy the full-resolution textures (skip `_SD` copies), MSDF atlases, favicons and patterns.

### 8. Process material (if available)
Dated animation-state exports (Theatre `config/*.json`) tell a growth story: `media/theatre_history.py <dir>` gives keyframes per export
(one project went from 4 to 377 in six weeks). The same data also gives the sound automation lanes.

### 9. Board and hand-off
- Build the exploration board per `references/board.md` (start from a previous `_toolkit/board/` if there is one). Publish it; it starts private.
- Copy masters into the output layout, save this project's recipes, scripts and board source into `_toolkit/`, and kill your Chrome, dev server and background jobs. Run `git status` in the project and revert anything you changed.
- In the final message, give the board link and the masters folder with a short table of what's where, plus findings worth knowing:
  bake flaws, perf oddities, unused assets, a local build that doesn't match production.

## Bundled files
- `scripts/browser/`: `chrome.sh`, `cdp.js`, `hook.js`, `rec.js`, `prelude.js`, `boot.js`, `map.js`, `solo.js`, `layers.js`, `film.js`, `hold.js`, `click.js`, `instances.js`
- `scripts/media/`: `frames2mp4.sh`, `cut_film.sh`, `enc_web.sh`, `sheet.sh`, `export_sounds.sh`, `soundtrack.py`, `export_svgs.js`, `theatre_history.py`
- `scripts/blender/`: `common.py`, `chapters_lib.py`, `encode.sh`
- `references/`: `gotchas.md` (read first), `blender.md`, `board.md`
- `examples/`: `recipe-template.js`, `transition-anatomy.js`, `type-on-black.js`, `clips-template.txt`, `soundtrack-spec.json`
