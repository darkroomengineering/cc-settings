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

- **A random theme per load** (cookie or localStorage) makes captures disagree. Lock it (`COOKIES=` on `boot.js`), then capture each theme on purpose.
- **Production down, local blocked.** A revoked CMS token can 500 both. Public datasets read fine without one, so start the dev server with the
  token env vars empty (process env beats `.env.local`, so no file is edited). An origin-locked media CDN returns 403 to localhost; `origin-swap.js`
  fixes that in the capture browser only.
- **Frameworks write files when the dev server starts** (e.g. Next 16.3 generating AGENTS.md / CLAUDE.md). `git status` at hand-off.
- **Vite dev servers reload the page the first time a route pulls in new dependencies** ("optimized dependencies changed. reloading"),
  silently, in the middle of a capture. Visit every route once before recording, and check the dev log for that line.
- **Local env can gate the whole site** (a `SITE_PASSWORD`, basic auth, a "coming soon" flag). Start the dev server with that variable
  empty in the process env instead of editing `.env.local`.
- **Production may no longer be the campaign.** Sites that outlive a campaign get a "thank you, it's over" build with routes removed.
  Capture the campaign from the repo and the current state from production, and label which is which.
- **Dev-only overlays** (transition debuggers, locale switchers, a settings gear) and consent banners end up in every frame. Hide them
  with one injected stylesheet (`page.addStyleTag`, or `evaluateOnNewDocument` for cold loads) rather than per-capture fixes. Common consent
  roots: `#onetrust-consent-sdk`, `#CybotCookiebotDialog`, `#didomi-host`, `#usercentrics-root`. `:has()` reaches dev blocks with no class of
  their own (`div:has(> a[href="/debug"])`).
- **SPAs answer 200 for every path**, so `curl` can't tell you a route is gone. Screenshot each route on production before planning around it.
- **Live user content shows up in captures** (fan letters, comments, profile names). Note where it appears, and check with the client before
  any of it is published.

- **A capture can write to the client's production.** Finishing a game posts a score to its leaderboard (anonymous auth + insert); an end
  screen's sign-up form creates a real lead; analytics count every page view. Boot every capture with `BLOCK` / `FAKE_OK` (netguard.js), and
  remember the guard only exists in pages loaded after it was set: a page booted earlier needs `netguard.js` run on it live, with a probe
  request, before any take goes near a form. Never type a real person's address into a form, even a stubbed one.
- **The local checkout can be behind what shipped.** Compare `main` with `origin/main` at recon; scripts that click by label break when
  production's copy is newer (a button label changed after the local branch was cut).
- **Headless content area is not the window size.** `--window-size=1920,1080` gives a 1920x993 page, and a viewport override only lasts as long as
  the CDP session that set it, so a later task shot 1920x993. `boot.js` sizes the window itself; custom tasks should still check `innerHeight`.

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
- **React Three Fiber nests meshes 5+ groups deep.** Top-level toggles do nothing; use `onlyDeep` / `showDeep` / `restoreDeep` in recipes.
- **Hidden groups are often debug helpers** (camera-path lines, target markers). Only re-show groups that were visible originally (`O.vis`).
- **Uniforms the site rewrites every scroll** (e.g. chapter blend textures) can be pinned with `Object.defineProperty(u, 'value', { get, set(){} })`.
  `delete u.value` afterwards restores them.
- **Uniforms don't always live on `material.uniforms`.** Some classes keep them on `_uniforms` (check both), and `onBeforeCompile` materials
  can inject them into the compiled shader only, where nothing outside sees them. Then identify the mesh another way: instance count, blending,
  a map, or an own property (`material._aoUniforms`). Property names survive minification; class names don't, though dev builds still show them.
- **The app may reset `visible` every frame** (a particle or celebration system re-showing its bursts). Hiding the object does nothing; set
  `material.visible = false` instead, which app code rarely touches.
- **Several layers can live inside one shader.** A material that composites base, foil, stickers and text in one fragment shader is taken
  apart by rebuilding its shader with fewer steps: override the method or `onBeforeCompile` that builds the source, change a define so three
  compiles a new program, set `needsUpdate`. Then check which pass draws what: the step labels come from the stills, not the function names.
- **Restore state, or better, reload, between captures.** A forgotten `text(0)` from one script blanked the next script's titles.
- **A hook injected at document start lives only as long as the CDP session that added it.** `boot.js` injects it and disconnects, so any
  later full reload (a dev server reload, a hard navigation) comes back unhooked and `rec.js` refuses to start. Re-run `boot.js`, or inject
  the hook in the same script that reloads.
- **Two sessions on one machine share the default port 9333.** A second `chrome.sh` can't bind it, so its commands silently drive the first
  session's browser. Give each session its own port (`chrome.sh <profile> 9334`) and prefix every command with `CDP_URL=http://127.0.0.1:9334`.

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
  visible this way. Check a few individual late frames too: a sheet that looks frozen can be the sheet, not the capture.
- **Videos inside WebGL textures** are usually off-DOM `<video>` elements. `hook.js` tracks every video the page plays and steps it with the
  frozen clock (firing `ended` on non-looping ones, since intros often wait for it). Cold loads (preloader → intro) record fine from
  `domcontentloaded` with the clock already frozen; network loads keep running in real time meanwhile.

- **JavaScript timers race ahead of frozen frames.** Freezing rAF and `performance.now` alone leaves `setTimeout` / `setInterval` on wall-clock
  time, and a capture runs ~5-12x slower than real time, so key repeat, countdowns, game timers and challenge clocks jump ahead. `TIMERS=1`
  moves them onto the virtual clock. Libraries that time with rAF (GSAP, Tempus, Howler's end events via setTimeout) then follow too.
- **Scripted players fail on ordinary UI details.** A label rule re-fired forever because the picked value reappears in the dropdown's
  trigger; a 30-frame click gate fired before the next rule's 40-frame reading pause and closed the list each time; a centred input put the
  caret before the text so Backspace did nothing; the form rejected example.com. Guard rules with state flags, read the contact sheet after
  the first minute, and keep the take: continue on the same page and join with `join_takes.py`.
- **Two capture browsers double throughput** when takes are long (a full game run was ~10,000 frames at ~1 fps on a loaded machine): give
  each its own profile and port, and keep heavy encodes for after.

## Sound
- **Stems are mastered quietly.** One project averaged −46 dBFS, peaking around −26. Export normalized copies, and lift rebuilt mixes with one static gain plus
  a limiter, which keeps the site's balance.
- **Read every sound's metadata before publishing anything.** One shipped track was tagged "NOT APPROVED FOR RELEASE! Reference Only." and
  overshot 0 dBTP. Licensed music goes to Drive with a note, never onto a shareable board. `export_sounds.sh` writes each file's tags.
- **Sound choreography may live in the animation data.** One project keyframed every ambience volume in Theatre on the scroll timeline, so the real
  mix for any scroll path is computable (`soundtrack.py`). Grep the code for `play(` / sprite ids to find one-shots and their triggers
  (animation loop events, clicks, progress windows).

## Blender
- **Bakes:** unlit Emission(strength 1) of the baked sRGB texture, alpha maps hard-clipped at 0.25, view transform Standard. That matches
  MeshBasicMaterial on the web.
- **glTF imports use quaternion rotation.** Animate `rotation_quaternion` or switch the mode, or turntables won't spin.
- **Near-black bakes meant for fog** (objects meant to read as silhouettes) vanish on a dark background. Also render over the site's fog colour (`_fogbg`).
- **GPU instances exist only at runtime.** Export their matrices from the live page (`instances.js`) and convert three (x,y,z) → Blender (x,−z,y).
