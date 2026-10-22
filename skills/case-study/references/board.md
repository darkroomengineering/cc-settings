# The exploration board (Artifact)

A private web page for the team. It shows every deliverable as its own item, each with a slate saying what it is and how it was made, and
leads straight into the masters folder. Publish it with the Artifact tool. Before writing it, follow the Artifact tool's page contract and
design guidance (run the `quickstart` with intent "other" for a new board).

## Start from a previous board if you have one
If an earlier case study kept its board in `<assets>/_toolkit/board/` (`src.html` + `build.py`), copy both into `<WORK>/board/`, keep the
components, and rewrite every word of copy for the new project. Otherwise build these components:
- **Slate chips** per item: `Real capture` (from the site), `Built from real parts` (e.g. a camera move or composite made from site renders),
  `Offline render` (Blender). The kind of origin matters to the team, so keep it honest.
- **Layer scrubber** (`.scrub[data-set]`): range input plus step buttons over `L_<set>_NN.jpg`. Labels and notes come from the recipe and are
  inlined by `build.py` (`/*__SCRUBS__*/`).
- **Clip grid and stills grid**, generated from small arrays.
- **Sound board**: plays segments of the site's own sprite file (or individual files) via WebAudio, started from a click, with a gain boost for quiet stems.
- **Automation lanes** (per-stem volume across the scroll, from the animation data) and a **keyframe growth** step chart. Before writing chart
  code, load the `dataviz` skill.
- **Glyph / marks / textures grids** for image assets.
- The project's own fonts as published `woff2` files, plus its accent colour and HUD motifs. The board should feel like the project.

## Sections (in this order)
Index → Film (clips + stills) → one section per chapter (layer scrubber, live build video, turntable, clay/wire/bake, facts) → hero subject(s)
→ Transitions → Type → Interactions → Sound (lanes, sound board, every sound's waveform) → Image assets → Process/choreography → Toolkit
(method, what else we can make, things we noticed).

## Media and publishing limits
- Web encodes: `media/enc_web.sh` (720p H.264 + poster), stills at 1280 px JPEG q4, SVGs as-is. Keep each file under 15 MB.
- One publish sends at most 64 MB, and a version holds up to 256 MB. Publish the first version with what fits, then publish again to the same
  file path with only new or changed files (`{"media/x": "media/x"}`) and `null` for removed ones.
- Only CDN scripts load, so inline data with `build.py` placeholders (`/*__DATA__*/`, etc.), not `<script src>`.
- Use `preload="none"` or `metadata` on videos, muted autoplay loops only for short clips (gated by IntersectionObserver and reduced motion), and `loading="lazy"` on images.
- Check before publishing: `node --check` the inline script, look for missing `media/` refs, and take one look at desktop and phone width.
  Screenshot sections, not the full page (it crashed a tab). A script error in one component kills everything after it: declare data before using it.
