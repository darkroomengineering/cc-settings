---
name: case-study
description: Turn any web project (WebGL, three.js, React Three Fiber, Theatre.js, GSAP or Lenis scroll sites, plain DOM sites, and browser games or app-like flows) into case-study material for the studio website. Produces frame-perfect 16:9 clips of every chapter and transition (games are played through by a script with real input), layer-by-layer decompositions of every scene, Blender turntables and clay/wire/bake renders, every sound exported separately with mixes rebuilt from the animation data, every image asset (glyphs, logos, frames, textures, sprite sheets) exported separately, and a shareable exploration board with playable pieces rebuilt from the project's own assets. Triggers "case study", "showcase", "portfolio piece", "making-of", "breakdown", "how it's made", "decompose the scene", "take apart the landscape", "record the site", "capture footage", "turntable", "export the sounds", "extract the icons/assets". Use when a finished project needs to be shown, even if nobody says "case study".
requires:
  - command: ffmpeg
    install: "brew install ffmpeg (encoding, contact sheets, sound export)"
  - command: node
    install: "Node 18+ (puppeteer-core capture rig; run bun add --cwd scripts/browser puppeteer-core once)"
---

# Case study from a project

The goal is raw material a designer can build a case study from: many separate, clean, 16:9 videos and images that show **how the work
is made**, not one showreel. Everything comes from the project itself: the live site rendered by its own code, its own GLB models and
bakes, its own stems and SVGs. Nothing is invented, and each item says how it was made. Two outputs are made on purpose and labelled as
such: fake data in place of private data, and faux UI pieces rebuilt with Stageshow (see "The pack").

## Fit the pipeline to the project
Every project is different; run the phases that apply and say which you skipped and why.

| Project | Works as is | Adapt |
|---|---|---|
| three.js based (vanilla, React Three Fiber, Threlte, TresJS) | everything | nothing |
| Other WebGL engines (Babylon, PixiJS, OGL, Spline, Unity WebGL) | film, clips, holds, clicks, DOM-mode layers, sound, image assets, board | no scene hooks: reach the engine's own globals in `page.evaluate` for 3D layers; Blender only if model files exist |
| DOM / GSAP / Lottie / video sites | film (the clock also steps CSS animations and video), DOM-mode layers via `css()`, clicks, sound, assets, board | skip Blender, solo and instances |
| Multi-page sites | everything, per page | `boot.js` each URL; "chapters" become pages or sections |
| No sound / no Theatre keyframes | — | skip phase 6, or place stems by section from the code's triggers |
| Games and app-like flows (keyboard play, timers, forms) | layers, sound, assets, tokens, board | boot with `TIMERS=1` and a network guard; the film is a scripted playthrough (`examples/play-template.js`), cut by its logged events; 2D sprite games skip Blender and rebuild the level from their atlases instead |

## The pack
This skill is the entry point of a pack: it decides which parts run for a project, and a new skill joins the pack as a row here.
Canvas sites (WebGL, games on a canvas) use this skill's own capture and 3D phases. DOM sites and app UI use the same capture phases
plus the faux UI pieces.

| Part | Where it lives | Runs for |
|---|---|---|
| Capture rig, layers, clips, sound, image assets, colours and typography, board | this skill | every project |
| 3D passes, solo, instances, Blender turntables | this skill | canvas sites with three.js or model files |
| Fake data layer (`fakedata.js`) and leak check (`leakcheck.js`) | this skill | any project that shows private data: customers, people, amounts, emails |
| Faux UI pieces: stills, cursor demos, bento grids | the [Stageshow](https://benji.org/stageshow) skill, installed from its own source | DOM product UI (phase 4b) |

Outside skills stay installed from their own sources so they keep their authors' updates; never copy them into this skill. A part that
is not installed is skipped and named in the final message.

## What the user expects (learned the hard way)
- **No private data in any output.** A project that shows client or customer data is captured with fake but convincing data from the
  first take (phase 2), and every output passes `leakcheck.js` before it leaves the machine (phase 10). Both only know the values in
  the map: a name nobody listed passes both. Look at every contact sheet for names, amounts and faces the map missed.
- **16:9, 1920×1080 masters for everything**, including stills, grids and Blender renders. Re-render instead of cropping.
- **A list of separate videos and images, never just one film.** Cut long captures into per-chapter and per-transition clips, plus stills.
- **Every chapter gets the same depth.** Each one is decomposed layer by layer and gets a 3D turntable. Don't stop at the most obvious scene.
- **Every sound and every image asset as its own file**, including small UI glyphs such as a navigation rail's icons.
- **Colours and typography are part of every case study**: palette, themes, each typeface, the type scale, and what the live site really uses.
- **Masters go to the studio Drive, one folder per project**, and the board links to that folder (phase 10).
- **The repo stays clean.** No commits. Revert lockfile or config churn caused by installs and dev servers.
- **Captures never write to the client's production.** No score rows, no leads, no analytics hits, no anonymous sign-ins: block or fake those
  requests in the capture browser (`BLOCK` / `FAKE_OK`, phase 2) before the first take, and never submit a real form.
- **The board is something to play with, not only to watch.** The user asked for more interactivity and immersion: give each chapter a
  playable piece rebuilt from the project's own assets and logic (state buttons for a character, the level itself, its mini-games, a music
  machine, layer toggles, a camera pull-back slider). See "Playable pieces" in `references/board.md`.
- Show progress with contact sheets, and look at every capture (Read the image) before using it.

## Output layout
Masters go next to the project: `<parent of project>/<project>-case-study-assets/`. Working files go in the session scratchpad (`<WORK>`).
```
01_film/            video/00_full_scroll.mp4 (or a page-by-page tour)   clips/: one per chapter & transition (cut_film.sh)   stills/: ~24 frames
02_ch1_<name>/      stills/layer_NN_<label>.png   video/layer_build_live.mp4, hero shots   blender/ turntable + clay/wire/bake
03_ch2_<name>/ ...  (one folder per chapter, numbered in site order)
NN_transitions/     anatomy grid + labelled sequence + per-stage clips & stills
NN_type/            reveal on black, cursor response, stills
NN_sound/           stems_original/ stems_normalized/ stills_per_sound/ clip_soundtracks/ mixes/
NN_image_assets/    svg/<glyphs|logos|frames|ui>/ (svg + 2048 png + png on dark), glyph sheet 16:9, textures/<scene>/, cms/<site|blog|unreferenced>/
NN_colors_typography/ colors_palette.png, colors_<theme>.png, type_<family>.png, type_scale.png, type_in_use.png
NN_faux_ui/         Stageshow pieces (phase 4b): stills/, video/, each file name starting with faux_ so nobody mistakes it for a capture
_toolkit/           this project's recipes, capture scripts, Blender sets, board source (kept private, next to the masters)
```
Project-specific code (recipes, shader names, board copy) belongs in `_toolkit/`, never in this skill. Before starting, look for a previous
`*-case-study-assets/_toolkit/` to reuse.

## Workflow

Run the phases in order. Run Blender (phase 5) as a background subagent as soon as phase 1 has found the models, so it renders while you
capture. Before starting, read `references/gotchas.md`: each item there cost hours once. Hand other
independent work to background subagents too (image and sound export, a second project), each with its own Chrome port
(`chrome.sh <profile> 9335` + `CDP_URL`) and its own output folder, so nobody drives anyone else's browser.

### 1. Recon (10 min)
- **Stack:** read `package.json` (three, @react-three/fiber, postprocessing, @theatre/core, gsap, lenis, howler, troika, lottie, pixi, babylon…).
- **Assets, wherever they live** (public/, src/assets, static/, a CDN):
  `find . \( -name "*.glb" -o -name "*.gltf" -o -name "*.ktx2" -o -name "*.svg" -o -name "*.mp3" -o -name "*.wav" -o -name "*.ogg" -o -name "*.json" -path "*config*" \) -not -path "*/node_modules/*" -not -path "*/.next/*"`.
  Note texture/mesh encodings: KTX2/Basis and meshopt need converting before Blender (see `references/blender.md`).
- **Structure:** read the page and section components to learn scene order, section names, what each scene loads, any transition shader, the
  text system and the sound triggers (`grep -rnE "new Audio|Howl|\.play\(|AudioContext|\.(mp3|wav|ogg)" --include=*.{js,jsx,ts,tsx,svelte,vue} .`).
- **Design tokens:** where colours, themes, fonts and the type scale are defined (`styles/colors.*`, `fonts.*`, `typography.*`, a Tailwind config,
  CSS custom properties, `next/font` loaders).
- **Is the checkout current?** `git fetch` then `git log --oneline main..origin/main`: a stale local branch explains copy or features that
  differ from production (one project was 9 commits behind; production matched origin/main). Read source from origin when it is what shipped.
- **Side effects:** list every request the site makes that writes somewhere (`grep -rnE "fetch\(|axios|supabase|insert|/api/|hubspot|mailchimp|gtag|analytics"`):
  score uploads, sign-up and contact forms, anonymous auth, analytics. They become the `BLOCK` / `FAKE_OK` patterns for every boot.
- **Private data:** does the site or app show real people, customers, amounts, emails or photos of people (dashboards, CRMs, admin
  views, anything behind a login)? If so, write `<WORK>/map.json` for `fakedata.js` before the first capture: each real value with a
  fake of the same length and format ("Jane Doe" → "Mia Lund", "$48,213.90" → "$31,870.40"), a pattern for each family of values (every
  email on the client's domain), and a stand-in image for each photo. List the values from the live app with the user, then keep
  the fakes the same for the whole case study. List every form a value takes: the raw number the API sends (`48213.9`) as well as the
  formatted one, and short forms such as a first name alone, as a word-bounded pattern (`\bJane\b`) so "Janet" stays. The map only works
  for values a person can list: when the app shows more (a CRM with hundreds of contacts), ask for a demo account or a local build
  seeded with fake data first, and keep `fakedata.js` for what is left. The map lists the real values: it stays in `<WORK>`, never in `_toolkit/`, Drive or the board.
- **Production URL:** find it (grep for the domain, or ask). Then decide where to capture from: run the local dev server and production
  side by side in the rig and compare. Prefer whichever renders correctly and matches what shipped. Usually that's production.
  If production is down, run locally. Common local blockers, all fixable without touching the repo: a stale CMS token (if the dataset is
  public, start the dev server with the token env vars set to empty), and a media CDN that only serves the production origin
  (run `scripts/browser/origin-swap.js "<cdn glob>" <production origin>` in the background while capturing).
- **Tools:** `ffmpeg`, Blender.app, Chrome, and puppeteer-core installed once with `bun add --cwd <SKILL>/scripts/browser puppeteer-core`.

### 2. Browser rig
```
<SKILL>/scripts/browser/chrome.sh <WORK>/chrome-profile        # run_in_background; headless, real GPU, 1920x1080
cd <SKILL>/scripts/browser && node cdp.js boot.js <url> [gateX,gateY]   # fresh load + hook.js; click a sound/enter gate if any
# another session already on 9333? chrome.sh refuses a busy port: use `chrome.sh <profile> 9334` and prefix commands with CDP_URL=http://127.0.0.1:9334
# COOKIES="theme=gold" node cdp.js boot.js …  locks a random theme / skips a consent banner; capture every theme as its own shot
# TIMERS=1 …                                   also freezes setTimeout/setInterval (games, countdowns, app flows: anything that runs on JS timers)
# BLOCK="supabase\.co|analytics" FAKE_OK="/api/signup" …   fail / locally answer requests that would write to production (netguard.js)
# a page loaded before the guard: BLOCK=… FAKE_OK=… node cdp.js netguard.js /api/signup   installs it live and proves the stub answers
node fakedata.js <WORK>/map.json   # run_in_background, BEFORE boot.js: fake data in every response (HTML, JSON, scripts) and image
node cdp.js leakcheck.js <WORK>/map.json   # after each boot: exits 1 and names each real value still on the live page
```
With private data, start Chrome with a fresh profile folder: a profile that has seen the real app keeps cached data and service workers
that never reach the network, so the fake data layer cannot replace them. WebSocket and WebRTC messages also pass through unchanged; if
the app streams its data that way, fake it in the app's own seed or a local build instead.
`hook.js` is injected before the page's own scripts. It grabs every three.js Scene, the renderer and the postprocessing passes (pmndrs
`postprocessing` and three's own `EffectComposer`) as they are constructed (no source edits, works on minified production; `boot.js` reports
`webgl: false` on sites without three.js), and installs a **virtual clock**: `__vt.start()` freezes rAF,
`performance.now`, `Date.now`, CSS animations and `<video>`, then `__vt.step(ms)` advances exactly one frame. `rec.js` steps it 1/60 s per
screenshot, so captures are frame-perfect at any resolution and identical on every run, with no dropped frames. All tasks run as
`node cdp.js <task.js> args…`, with output folders set by the `OUT` env var.

### 3. Map the site
- `node cdp.js map.js <y1,y2,…>` visits those scroll positions (so lazy chapters load), then prints every scene graph with vertex counts, material
  uniforms, instancing and visibility, the postprocessing chain, tall DOM sections with their scroll offsets, and the large canvases / videos / SVGs / Lottie containers.
- Identify each chapter's scene by a stable feature, such as a unique vertex count, a uniform name or a SkinnedMesh. Construction order changes on every load.
- Pick a hero scroll position per chapter: screenshot a few candidates, and project the subject to screen space if there is one.
- **For each hero position, run `solo.js <y> "<scene pred>"` and look at the result before writing that chapter's recipe.** It shows what the
  camera really sees: off-frame sets, instances doing the work, hidden debug helpers.

### 4. Captures (each from a fresh `boot.js`)
- **Film:** `film.js 0 <end> <seconds>` (as shipped, linear scroll), encoded with `media/frames2mp4.sh`. Then cut it into per-chapter and
  per-transition clips plus ~24 stills with `media/cut_film.sh` (clips file: `name|start|end`). Find boundaries from section offsets and a contact sheet.
  Pages that scroll an inner element (a Lenis wrapper): `SCROLLER="<css>"` on any task. **Preloaders and intros:** `cold.js <url> <s>` records
  from first paint (`HIDE="<css>"` removes dev overlays and consent banners from frame one). **Multi-page / app-like sites:** film each page,
  and record the main journey as one take with `interact.js` clicking through the real UI (in-app navigation and page transitions included),
  then cut it into per-step clips; a page-by-page tour (ffmpeg concat) replaces the single scroll film.
- **Layer decomposition per chapter:** write a recipe (`examples/recipe-template.js`; helpers are documented in `layers.js`), then
  `OUT=… node cdp.js layers.js recipes.js <set> 1.25`. That gives stills `NN_label.png` plus a live build video (one layer every 1.25 s, with the scene still
  animating). Typical 3D order: raw geometry/bake → sky → each mesh family (name instance counts) → atmosphere (clouds, mist, fog, rain) →
  lens effects (`fx(__H.LENS, 1)` or a project regex) → type layer → `ui(1)` interface. DOM sites: omit `scene` in the recipe and build the
  page up with `css(selector, true/false)` (background media → illustrations → headlines → copy → interface). Minified builds can mangle
  three/examples pass names; then toggle `__H.effs[i].enabled` by index. Wrap captures in a retry loop, because tabs die under memory pressure.
- **Hero subjects** (characters, products): `hold.js <y> <s>` for a clean hold, or with a target predicate and zoom for a push-in
  (`setViewOffset`, which stays sharp). To time foley to a motion (a head shake), log a bone's quaternion per frame in `perFrame` and find the angular-velocity peak.
- **Transitions:** freeze mid-transition, take over the shader's progress uniform, and switch its ingredients on one by one. Include the shader's
  debug mode if it has one. Deliver a 3×3 16:9 grid plus a labelled sequence (`examples/transition-anatomy.js`; tile with ffmpeg `xstack` into 640×360 cells).
- **Type:** titles alone on black (`examples/type-on-black.js`: either pin a blend shader's inputs black, or hide every non-text mesh), plus a
  scripted cursor pass if the type reacts to the pointer. DOM titles: a DOM-mode recipe that hides everything but the heading.
- **Interactions:** `click.js <y> 7 0.6` for a single click; `interact.js <y> <s> "30-200:path:x0,y0:x1,y1;240:sel:#cta;300-420:drag:…;500:key:ArrowRight"`
  for hovers, cursor sweeps, selector-aimed clicks, drags, wheel and keys at exact frames (it returns the frame of each action). Glide the pointer
  to each target before clicking so pointer-driven cameras stay smooth. Lay the matching sounds at those times.
- **Games and app journeys:** play them, don't scroll them. Copy `examples/play-template.js` into `_toolkit/` and give it rules (read the
  screen each frame, wait a reading time, click or hold real keys); boot with `TIMERS=1` and the guard. Record a winning run, a losing run
  (failures, hints, quitting) and the end screens as separate takes; each writes `events.json` (every click, key, phase and sound with its
  frame), so clip lists and soundtracks come from real beats. Solve levels offline (BFS over the level data) so the script walks the real
  route. Watch a contact sheet after the first minute: a rule that loops wastes the whole take. To end a take from outside, delete
  `window.__probe` (the `finally` still writes the log); to fix one mid-way, continue on the same page into a new folder and stitch with
  `media/join_takes.py`. Long takes run ~1-3 fps on a busy machine: run independent captures in a second Chrome on its own port.
- **3D subjects with no model file** (procedural cards, runtime instancing, shader-drawn surfaces): `spin.js "<target pred>" 8` spins the live
  object a full turn with the site's own shaders, which stands in for the Blender turntable. Say which it is.
- Check every capture with `media/sheet.sh` + Read before moving on.

### 4b. Faux UI pieces (DOM product UI)
Real footage can't always show a feature cleanly: it sits behind a login, needs data the account doesn't have, or is buried in other
UI. A faux UI piece rebuilds just that moment as a still or a short cursor demo, in the product's own look. Use the
[Stageshow](https://benji.org/stageshow) skill for it; if it is not installed, ask the user before installing it
(`bunx skills add benjitaylor/skills --skill stageshow`), or skip this phase and say so.
- **Pick the moments:** one per feature the case study must explain, plus a bento grid if the page needs one. Name each in the plan.
- **Build outside the client repo,** in `<WORK>/faux-ui/` (Stageshow's own preview, or a scratch Vite app). Keep the source in
  `_toolkit/faux-ui/` afterwards. The repo stays clean.
- **Its look comes from phase 8:** map `design.json` and the live tokens onto Stageshow's tokens (its `references/looks.md`), and use
  the project's own icons, logos and fonts from phase 7.
- **Its content uses the fake side of `map.json`,** never real values, so the faux UI and the captures show the same fake people.
- **Masters are 1920×1080 like everything else:** keep the stage at Stageshow's own design size (its framing rules depend on it) and
  frame it on the project's ground in a 1920×1080 page; give the stage's container `data-ss-fill` so it grows past its design size.
  Record that page with this skill's rig: `TIMERS=1 boot.js` on the preview URL (Stageshow's script waits on timers, and without
  `TIMERS=1` the loop plays about three times too fast), then `interact.js` with no actions (or `hold.js` with `clean=0`; its
  default hides the DOM and records a blank frame). The take starts wherever the loop is after the rig's settle wait: record one and a
  half loops and cut one whole loop. The stage's crop shows as a hard line on the ground, so nothing may cross the stage edge
  unless it fades there. Use Stageshow's `film.mjs` for its review sheets, and check the first take's contact sheet.
- **Label it:** files start with `faux_` in `NN_faux_ui/`, and the board says "rebuilt with Stageshow, not a capture" on each piece.
- Run Stageshow's own rehearsal (`--gate`) and look at the contact sheet before recording the master. Its gold examples also fail
  some gate lines, so report every line that remains; never clear one by hiding or marking the element it names.

### 5. Blender (delegate early)
Follow `references/blender.md`. Most sets need no code: `scripts/blender/turntable.py -- --glb <file> [--glb …] --name <set> --job probe|stills|turntable`
gives a seamless auto-framed 360° turntable plus clay / wire / look stills for any glTF, using its own materials (lit sites) or baked textures
mapped with `--tex "<mesh>=<color.png>[:<alpha.png>]"` (baked, unlit sites). Probe first and look at the sheet. Sets that only exist at
runtime (GPU instances from `instances.js`, shaders ported from the site) need a small `sets.py`; hand those to a background subagent with the
brief in `references/blender.md`, and review its overview sheet when it reports.

### 6. Sound
- `media/export_sounds.sh <sounds_dir> <out>/NN_sound <accent> <bg> <font>` exports, for every sound, the original file, a copy normalized to −1 dB peak,
  a 16:9 waveform and a spectrogram.
- Sprite-only projects (one file + offsets JSON): cut each sound out first, e.g. `ffmpeg -ss <start_s> -t <dur_s> -i sprite.mp3 <name>.wav`.
- If the volumes are keyframed (Theatre `sounds` objects, GSAP timelines), rebuild the real mix for each capture's scroll path with
  `media/soundtrack.py` (spec documented in the file; example in `examples/soundtrack-spec.json`). Add one-shots where the
  code fires them: loop events, click times, progress windows. Otherwise place stems by hand along the clip timeline (ffmpeg `adelay` +
  `amix`), following the triggers in the code. Mux the result onto each clip, and export each clip's soundtrack as its own WAV.

### 7. Image assets
- `node media/export_svgs.js <svg_dir> <out>/NN_image_assets/svg <dir with sharp>` (the project's `node_modules` usually has it; otherwise
  `bun add --cwd <WORK> sharp` and pass `<WORK>`): each SVG as svg + 2048 px
  transparent PNG + PNG on dark, grouped into glyphs / logos / frames / ui. Then add a 16:9 sheet of the glyphs.
- Copy the full-resolution textures (skip `_SD` copies), MSDF atlases, favicons and patterns.
- **Sprite sheets** (TexturePacker-style PNG + JSON): export every frame, each animation as a 16:9 strip and a loop at its in-game fps, and the
  unique tiles of tile atlases (packers alias many cells to one rect: count both). A tiled level can be rebuilt whole from its atlases at native
  resolution, which stands in for a turntable. Check each PNG against the atlas's `meta.size` (one splash shipped at half its authored size).

### 8. Colours and typography
- `OUT=<WORK>/tokens.json node cdp.js tokens.js <y1,y2,…>` (multi-page: `PAGES="url1,url2,…"`; `HIDE="<css>"` keeps dev overlays out) records what the live site really uses: `@font-face` files, every rendered text style
  (family, size, line-height, tracking, weight, case) with counts and a real sample, CSS colour variables, colours in use.
- Scene colours often live in animation data rather than CSS (Theatre state JSON, GSAP configs): walk it for `{r, g, b}` objects and make each
  scene a group ("Letter room", "Globe"), labelled as approximate when values are linear.
- Write a `design.json` from the source tokens (`examples/design-template.json`): named palette, themes / modes as groups, typefaces with roles,
  the named type scale with real copy from the site. It gives the sheets proper names; skip it and the sheets fall back to the live tokens.
- `OUT=<out>/NN_colors_typography node cdp.js specimens.js <tokens.json> [design.json]` renders 16:9 sheets in the project's own fonts: palette,
  one per theme, one specimen per typeface, the type scale, and the styles found live. Compare the last two: drift between the system and
  what shipped is a finding.

### 9. Process material (if available)
Dated animation-state exports (Theatre `config/*.json`) tell a growth story: `media/theatre_history.py <dir>` gives keyframes per export
(one project went from 4 to 377 in six weeks). The same data also gives the sound automation lanes.

### 10. Drive, board and hand-off
- **Leak check first (projects with private data):** `node scripts/browser/leakcheck.js <WORK>/map.json <out> <WORK>/<each take's frame folder> <WORK>/tokens.json <board source>`.
  It searches every text file (including `tokens.json` samples and the board's copy) and reads stills and frames with tesseract OCR. It
  skips videos, so name the frame folder of every take you encoded; never point it at the Chrome profile. Exit 1 names
  each output with a real value: redo it with `fakedata.js` running. Exit 2 means images were not read (no tesseract): not a pass.
  Nothing goes to Drive or the board until it exits 0. OCR misses some type, so this backs up the live check of phase 2; it does not replace it.
  Exit 0 proves only that the listed values are gone: the contact sheet review for unlisted names and faces still applies.
- **Upload the masters to Drive:** `media/drive_upload.sh <out> "<Client - Project>"` copies everything except `_toolkit/` into the
  project's folder under the studio's case-study root ("Website - Case Study - Assets", whose URL `CASE_STUDY_DRIVE_ROOT` must hold; ask the user for it, it is not in this public repo), reusing a
  folder that already has the project's name (look at the root's folder names first and match their "Client - Project" style), and prints
  the folder URL. It needs rclone with a Drive remote: if `rclone listremotes` shows none, run `rclone config create gdrive drive scope=drive`
  in the background and ask the user to approve the Google sign-in it opens. Never delete or overwrite files someone else put in the folder; the script refuses to replace a changed file.
  The Google Drive connector can create a folder or list one, but can't carry large binaries; use it to check the result, not to upload.
- Build the exploration board per `references/board.md` (start from a previous `_toolkit/board/` if there is one), with the Drive folder
  linked in its header, and its playable pieces. Test it in a real browser over `http://` with a UTF-8 charset before publishing
  (`file://` blocks the atlas fetches; a charset-less server garbles the arrows). Publish it; it starts private.
- Save this project's recipes, scripts and board source into `_toolkit/`, and kill your Chrome, dev server and background jobs. Run `git status` in the project and revert anything you changed.
- In the final message, give the board link, the Drive folder and the local masters folder with a short table of what's where, plus findings worth knowing:
  bake flaws, perf oddities, unused assets, a local build that doesn't match production.

## Bundled files
- `scripts/browser/`: `chrome.sh`, `cdp.js`, `hook.js`, `timers.js` (TIMERS=1), `netguard.js` (BLOCK / FAKE_OK), `fakedata.js` (fake data in every response), `leakcheck.js` (finds real values on the live page or in outputs), `rec.js`, `prelude.js`, `goto.js` (scroll like a visitor, never jump; `SCROLLER` for inner scrollers), `boot.js`, `cold.js`, `map.js`, `solo.js`, `layers.js`, `film.js`, `hold.js`, `click.js`, `interact.js`, `spin.js`, `instances.js`, `tokens.js`, `specimens.js`, `origin-swap.js`
- `scripts/media/`: `frames2mp4.sh`, `cut_film.sh`, `enc_web.sh`, `sheet.sh`, `export_sounds.sh`, `soundtrack.py`, `export_svgs.js`, `theatre_history.py`, `drive_upload.sh`, `join_takes.py`
- `scripts/blender/`: `turntable.py` (generic runner), `common.py`, `chapters_lib.py`, `encode.sh`
- `references/`: `gotchas.md` (read first), `blender.md`, `board.md`
- `examples/`: `recipe-template.js`, `play-template.js` (scripted play for games and app journeys), `transition-anatomy.js`, `type-on-black.js`, `clips-template.txt`, `soundtrack-spec.json`, `design-template.json`
- Worked examples live in past projects' `<project>-case-study-assets/_toolkit/` folders next to the masters (a WebGL scroll site, a DOM site,
  a 2D maze game with scripted play, sprite exports and a board of playable pieces): look there before writing a recipe, a player or a board.
