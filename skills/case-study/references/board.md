# The exploration board (Artifact)

A private web page for the team. It shows every deliverable as its own item, each with a slate saying what it is and how it was made, and
leads straight into the masters: link the project's Drive folder (from `media/drive_upload.sh`) in the header, as the first thing after the
title, and again in the footer. Publish it with the Artifact tool. Before writing it, follow the Artifact tool's page contract and
design guidance (run the `quickstart` with intent "other" for a new board).

## Start from a previous board if you have one
If an earlier case study kept its board in `<assets>/_toolkit/board/` (`src.html` + `build.py`), copy both into `<WORK>/board/`, keep the
components, and rewrite every word of copy for the new project. Otherwise build these components:
- **Slate chips** per item: `Real capture` (from the site), `Built from real parts` (e.g. a camera move or composite made from site renders),
  `Offline render` (Blender). The kind of origin matters to the team, so keep it honest. When production no longer matches the
  repo (a post-campaign build), also say where each item came from: `Live capture` (production) or `Campaign build` (the repo).
- **Layer scrubber** (`.scrub[data-set]`): range input plus step buttons over `L_<set>_NN.jpg`, opening on the finished frame (the first layers
  are often a dark wall or an empty sky) so the reader scrubs back to take it apart. Labels and notes come from the recipe and are
  inlined by `build.py` (`/*__SCRUBS__*/`).
- **Clip grid and stills grid**, generated from small arrays.
- **Sound board**: plays segments of the site's own sprite file (or individual files) via WebAudio, started from a click, with a gain boost for quiet stems.
  Licensed music (a band's track, anything tagged reference-only) stays off the board: show its waveform and point to Drive.
- **Automation lanes** (per-stem volume across the scroll, from the animation data) and a **keyframe growth** step chart. Before writing chart
  code, load the `dataviz` skill.
- **Glyph / marks / textures grids** for image assets.
- **Colours and typography**: the specimen sheets as figures, plus live swatches (hex as selectable text, click to copy) and the real
  font files loaded with `@font-face` so the type section is set in the project's faces.
- The project's own fonts as published `woff2` files, plus its accent colour and HUD motifs. The board should feel like the project.

## Playable pieces (the user wants interactivity and immersion)
Videos show the work; playable pieces let the team feel it. Give each chapter at least one, rebuilt in the page from the project's own
assets, data and logic, never invented. Label them as built from real parts, and say in one line what follows the code exactly and what is
approximated (a post-process pass redrawn in 2D, say).
- **Ideas that worked:** state buttons for a character (every animation, pose and transition on a button, arrow keys to drive it, a
  readout of the current frame); the level or scene itself, playable with the real controls, rules and timer, with layer toggles and a
  camera pull-back slider; the project's mini-games with their real copy, timings and scoring; a mood or variant switcher; a replay
  button for a countdown or reveal; a music machine that reproduces the audio logic (the chain of loops, "reach the end" waiting for the
  track to finish, the stings). Existing pieces: the layer scrubber, swatches that copy their hex.
- **Build:** one inline script (`/*__PLAY__*/` in `src.html`, filled by `build.py`), vanilla canvas and DOM, no library. Publish the project's
  sprite atlases (PNG + JSON) and fetch them at runtime; inline small data (level grids, copy, timings) into `DATA`. Draw pixel art with
  `imageSmoothingEnabled = false`. Port the project's logic line by line (movement, collisions, animation selection, dissolves) rather
  than imitating it from the footage. Inside a stage, use the project's own look (its window chrome, buttons, type at the site's scale via
  `cqw`); outside, the board's tokens.
- **Behave on a page:** start each piece only when it scrolls near (IntersectionObserver) and pause its loop off screen; take keyboard input
  only while its stage is focused (and `preventDefault` arrows so the page doesn't scroll); give touch a d-pad; play sound only after a
  click or key, with a sound toggle; respect `prefers-reduced-motion`.
- **Test before publishing:** serve the board over `http://` with `charset=utf-8` and drive each piece with puppeteer like a visitor (click
  through a challenge, walk a real route into an enemy), screenshot every step, and check phone width for horizontal overflow
  (grid items holding wide SVGs need `min-width: 0`).
- Worked example: the `_toolkit/board/play.js` of a past game case study (ball puppet, playable maze, challenge arcade, mood switcher,
  countdown, music machine).

## Sections (in this order)
Index → Film (clips + stills) → one section per chapter (its playable piece, layer scrubber, live build video, turntable, clay/wire/bake, facts) → hero subject(s)
→ Transitions → Type → Interactions → Colours & typography → Sound (lanes, sound board, every sound's waveform) → Image assets →
Process/choreography → Toolkit
(method, what else we can make, things we noticed).

## Media and publishing limits
- Web encodes: `media/enc_web.sh` (720p H.264 + poster), stills at 1280 px JPEG q4, SVGs as-is. Keep each file under 15 MB.
- One publish sends at most 64 MB, and a version holds up to 256 MB. Publish the first version with what fits, then publish again to the same
  file path with only new or changed files (`{"media/x": "media/x"}`) and `null` for removed ones.
- Only CDN scripts load, so inline data with `build.py` placeholders (`/*__DATA__*/`, etc.), not `<script src>`.
- Use `preload="none"` or `metadata` on videos, muted autoplay loops only for short clips (gated by IntersectionObserver and reduced motion), and `loading="lazy"` on images.
- Check before publishing: `node --check` the inline script, look for missing `media/` refs, and take one look at desktop and phone width.
  Screenshot sections, not the full page (it crashed a tab). A script error in one component kills everything after it: declare data before using it.
