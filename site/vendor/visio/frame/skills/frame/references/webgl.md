# WebGL in a project

visio has no WebGL package. A project writes the smallest renderer that does what its design draws, in its own `src/`:

- One shader on a hero or a band: raw WebGL, or a few classes of OGL (`ogl`).
- A scene with physically based light, shadows or physics: three.js.

Do not copy an old `@visio/gl`. The last release that had it is `v2026.11.03-2257`. Read its `gl/DESIGN.md` and `gl/src/` for how it solved a case: `git log --diff-filter=D -- vendor/visio/gl` gives the commit that deleted it, and `git show <commit>^:vendor/visio/gl/DESIGN.md` gives the file. Then write only the part that the project needs. The rules below are what each renderer must still do.

## The loop

- Draw from the frame loop: `useFrame(draw, { order: ORDER.render })` from `@visio/frame`. Never a `requestAnimationFrame` loop of your own: lint bans it. The render slot runs after the scroll and the animations, so a draw reads this frame's values.
- Draw only when something changed: an object moved, a uniform got a new value, a texture loaded, the canvas resized, or a shader on screen reads the time. Else return `false`, so the loop sleeps. Call `wake()` when an event outside the loop needs a draw (a texture that loads, a video that plays). One exception: a canvas fixed over the viewport with an object over a page element on screen returns nothing, not `false`, because a native scroll does not wake the loop.
- Stop the time under reduced motion: read `reducedMotion()` from `@visio/frame`, and keep drag and scroll working.

## The canvas

- Read the size from the canvas's own box with a `ResizeObserver`, not from `window.innerWidth`. A scrollbar that appears changes the box with no resize event.
- Cap the pixel ratio at 2: `Math.min(devicePixelRatio, 2)`. A ratio of 3 draws 2.25 times the pixels for detail that no one sees. Read it each frame, because a window that moves to another screen changes it with no resize.
- Ask for `premultipliedAlpha: true`. Blend with `SRC_ALPHA, ONE_MINUS_SRC_ALPHA` for colour and `ONE, ONE_MINUS_SRC_ALPHA` for alpha, and write straight alpha in the shader. An opaque mesh writes alpha 1.
- On `webglcontextlost`, call `preventDefault()` and free every object. On `webglcontextrestored`, build every object again. Test it with the `WEBGL_lose_context` extension.
- Each canvas is its own context: nothing is shared between two canvases, and browsers drop the oldest context past 16 (Chrome, WebKit). Keep the count low.

## Server, loading and cleanup

- The server renders the `<canvas>` element only. Make the context on the client, in `onSettled`, or in an effect that runs only on the client: `if (!isServer) createEffect(compute, apply, { transparent: true })`. Without `transparent`, the effect takes a hydration id that the server did not make.
- Import the WebGL code only on the pages that draw. A page with nothing to draw loads no WebGL code.
- Make the context after the first paint, so the shader compile does not delay it. Lint bans `requestAnimationFrame` in `src/`, so start it from the loop: a `frame()` callback that starts `setTimeout(create, 0)` once and returns `false`, and the timeout removes the callback. Do not remove a callback inside its own call: tempus then skips the next callback of that frame.
- When the component unmounts, delete each program, shader, buffer and texture. A page transition keeps the leaving page alive until its exit ends, so free at unmount, not at navigation.

## An object over a page element

- Read `getBoundingClientRect()` of the element in the render slot, every frame. An offset that you cached plus the scroll misses transforms, sticky parents, and the leaving page of a transition.
- A canvas fixed over the viewport trails a native scroll by one frame: the browser moves the page on its own thread, after the frame read the box. Use `<SmoothScroll />`, because Lenis moves the scroll at `ORDER.scroll`, before the read. Or put the canvas inside the section (`position: absolute; inset: 0` in a parent with a position), so it moves with the page and needs no draw for a scroll.
- A canvas in a section still trails an element that moves against it during a scroll (a sticky child, a scroll-driven transform). Put the canvas inside what moves.
- For one unit to be one CSS pixel at z = 0, use a perspective camera with a field of view of 30 degrees at a distance of `height / 2 / tan(15°)`.
- Hide the DOM image only while the mesh draws: set an attribute on its element and hide the image with CSS from it. Without WebGL, or before the texture loads, the image stays. Do not draw an object whose element is under `visibility: hidden` (`checkVisibility()`): the transitions outlet hides an entering page that way until its enter runs.
- Stop drawing an object far off screen: an `IntersectionObserver` with a margin of 25% of the viewport, so the loop sleeps after a hero scrolls away.
- A page that fades during a transition fades its meshes only if the shader multiplies by the opacity of the element's ancestors.

## Textures

- Upload the `<img>` that `<Image>` gives through `imgRef`, after it loads: that is the file the browser picked for the screen.
- An image from another origin needs `<Image crossorigin="anonymous">`, so its one download is a CORS request. Without it, WebGL refuses the image, and only a second download with CORS, from your own code, gets it.
- Do not use an `ImageBitmap`: WebGL ignores `UNPACK_FLIP_Y_WEBGL` for it, so it draws upside down next to every other source.
- For data, such as a depth map, set `UNPACK_COLORSPACE_CONVERSION_WEBGL` to `NONE` around the upload. Else WebGL applies the file's colour profile: a mid-grey PNG with a gamma of 1.0 read 188, not 128, in Chrome.
- Upload a 2D canvas directly, not through `toDataURL()` and an `<img>`.
- A video uploads each frame while it plays. Wake the loop on `play`, `playing`, `loadeddata` and `seeked`: a video with `preload="none"` can play before it has data.
- WebGL 1 makes mipmaps only at a power-of-2 size.

## OGL 1.0.11

- `new Renderer()` writes a pixel `width` and `height` into the canvas style. Set the style back to `100%`, and do not call `renderer.setSize()`.
- `renderer.render()` sets the viewport to the full canvas. To draw into a box, set the viewport and the scissor yourself.
- `setViewport` caches by width and height and ignores x and y. After your own `gl.viewport()`, set `renderer.state.viewport.width = null`, or the next full draw keeps your box.
- `program.remove()` deletes the program and not its shaders. `Texture` has no delete: call `gl.deleteTexture()`.
- `Program.use()` warns on each frame for an active uniform without a value, so do not draw an object with an undefined uniform.
- The first `getContext()` on a canvas fixes the context attributes.
