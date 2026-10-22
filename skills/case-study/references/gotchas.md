# Gotchas (each one cost real time on a past case study)

## Environment
- **Local build may not be what shipped.** On one project `main` rendered every 3D scene black locally after dependency bumps, while
  production (a different build) was fine. Check production first and compare. Capture from whichever renders correctly, usually production.
- **Installing can dirty the repo.** An older local pnpm rewrote `pnpm-lock.yaml` (lockfile v9 → v6), and `next dev` reformatted
  `tsconfig.json`. After any install or dev run, `git status`, then `git checkout -- <file>` for anything you didn't mean to change.
- **The Chrome DevTools MCP may be locked** by another session's profile. Use `chrome.sh` with your own profile dir and `cdp.js` instead.
- **Headed Chrome stops rendering when its window is hidden.** `document.visibilityState` turns 'hidden', rAF stops and screenshots hang.
  Headless (`--headless=new --use-angle=metal`) runs on the real GPU at 60 fps and is never throttled.
- **Memory.** Chrome on a heavy WebGL site and Blender together will swap a 16 GB Mac, and tabs crash mid-capture
  (`Target closed`). Reload between captures, retry a failed capture (wrap each capture in a 3-attempt loop that reloads first), and never take a
  `fullPage` screenshot of a very tall page; scroll and shoot sections instead.
- **zsh quirks.** `$VAR:t` is a zsh modifier (it ate `$FONT:text` in ffmpeg drawtext), so write `${VAR}:text`. Unquoted `$args` don't word-split
  in zsh, so use arrays. Put multi-step ffmpeg work in `bash` scripts.
- **`pgrep -f "x"` inside a shell loop matches its own command line.** Wait on a pid or a marker file instead, or the loop waits forever.

## Hooking production
- **The hook works on minified code** because three/postprocessing still assign `this.isScene = true` etc. Don't trap `uniforms`:
  it's too broad and broke the app. `isScene`, `isWebGLRenderer` and EffectPass `effects` are enough.
- **Scene construction order changes on every load, and chapters lazy-load.** Pick scenes by content (a unique vertex count, a
  uniform name, a SkinnedMesh) and re-scan `__big` each time. `prelude.js` does both.
- **Read originals before you toggle anything.** An effect's opacity, a uniform or a background may already be animated by Theatre
  (a noise pass sat at 0.04, not 1). Restoring "on = 1" quietly ruins the "final" frame. Store the values on first touch.
- **The type layer can be a cached render target.** Hiding the text meshes can do nothing when the titles are rendered once into a
  texture composited by a `TextureEffect`. Fade that effect instead. DOM headings with `opacity: 0` mean the WebGL copy is the visible one.
- **Solo every mesh before writing a recipe.** A scene graph can be dominated by objects the camera never frames, while what you
  see is something small in the graph (a few instanced meshes, say). A recipe written from the graph alone gives black layers. Use `solo.js`.
- **Hidden groups are often debug helpers** (camera-path lines, target markers). Only re-show groups that were visible originally (`O.vis`).
- **Uniforms the site rewrites every scroll** (e.g. chapter blend textures) can be pinned with `Object.defineProperty(u, 'value', { get, set(){} })`.
  `delete u.value` afterwards restores them.
- **Restore state, or better, reload, between captures.** A forgotten `text(0)` from one script blanked the next script's titles.

## Capture
- **Never jump to a scroll position.** A direct `scrollTo` skips the scroll-driven animation of everything in between: titles from
  earlier sections stay on screen and transitions stay half-played. All tasks use `goTo` (scroll in steps); do the same in custom scripts.
- **Frame-perfect beats real time.** `rec.js` steps the frozen clock 1/60 s per screenshot (≈5 frames per wall-clock second at 1080p), so
  no frame drops, any resolution, and identical reruns. Real-time MediaRecorder isn't worth it.
- **Scroll linearly** and let editors retime. The page loops past its last section on some sites, so end at the last section's bottom.
- **Parallax hides subjects.** A subject can be hidden behind foreground objects at one scroll position and clear 100 px earlier. Sample a few y positions (screenshots +
  project the target to screen space) before a long hold.
- **For a push-in, use `camera.setViewOffset`, not FOV.** It re-renders a shrinking window around the target, which stays sharp and stays
  centred on the subject.
- **Interactions** (click-triggered effects, hover) need a real input at an exact frame. Use `rec`'s `hook` (puppeteer `page.mouse`) and log the frame, so
  the matching sound lands on it.
- **Look at every capture before using it.** Contact sheet (`media/sheet.sh`) then Read. Black layers, wrong framing and stray helpers are only
  visible this way.

## Sound
- **Stems are mastered quietly.** One project averaged −46 dBFS, peaking around −26. Export normalized copies, and lift rebuilt mixes with one static gain plus
  a limiter, which keeps the site's balance.
- **Sound choreography may live in the animation data.** One project keyframed every ambience volume in Theatre on the scroll timeline, so the real
  mix for any scroll path is computable (`soundtrack.py`). Grep the code for `play(` / sprite ids to find one-shots and their triggers
  (animation loop events, clicks, progress windows).

## Blender
- **Bakes:** unlit Emission(strength 1) of the baked sRGB texture, alpha maps hard-clipped at 0.25, view transform Standard. That matches
  MeshBasicMaterial on the web.
- **glTF imports use quaternion rotation.** Animate `rotation_quaternion` or switch the mode, or turntables won't spin.
- **Near-black bakes meant for fog** (objects meant to read as silhouettes) vanish on a dark background. Also render over the site's fog colour (`_fogbg`).
- **GPU instances exist only at runtime.** Export their matrices from the live page (`instances.js`) and convert three (x,y,z) → Blender (x,−z,y).
