/** The baked-in reset, in the `reset` layer so any project style beats it. */
export const reset = `
*, *::before, *::after { box-sizing: border-box; min-width: 0; }
* { margin: 0; }
html {
  -webkit-text-size-adjust: 100%;
  text-size-adjust: 100%;
  -webkit-tap-highlight-color: transparent;
  hanging-punctuation: first last;
  overflow-wrap: break-word;
  color-scheme: light dark;
}
body {
  min-height: 100svh;
  line-height: 1.5;
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3, h4, h5, h6 { text-wrap: balance; font-size: inherit; font-weight: inherit; }
p, li, figcaption { text-wrap: pretty; }
img, picture, video, canvas, svg { display: block; max-width: 100%; }
img, video { height: auto; }
picture { height: 100%; }
picture > img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  background-position: center;
  background-size: cover;
  background-repeat: no-repeat;
}
picture > img[data-fit="contain"] { object-fit: contain; background-size: contain; }
input, button, textarea, select { font: inherit; color: inherit; letter-spacing: inherit; }
button { background: none; border: 0; padding: 0; cursor: pointer; min-width: auto; }
a, button, [role="button"] { touch-action: manipulation; }
a { color: inherit; text-decoration: none; }
ul[role="list"], ol[role="list"] { list-style: none; padding: 0; }
:target { scroll-margin-block: 5ex; }
:focus-visible { outline: 2px solid currentColor; outline-offset: 2px; }
::selection { background: color-mix(in oklab, currentColor 20%, transparent); }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 0.01ms !important;
    scroll-behavior: auto !important;
  }
}
`.trim();
