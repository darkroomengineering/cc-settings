import { defineTokens } from "@visio/styling";

export const t = defineTokens({
  screens: {
    mobile: { width: 375, height: 650 },
    desktop: { width: 1440, height: 900, from: 800 },
  },
  // Sizes are CSS px at every window width, like the app's own controls.
  fluid: false,
  layout: {
    columns: { mobile: 4, desktop: 12 },
    gap: { mobile: 12, desktop: 24 },
    safe: { mobile: 24, desktop: 48 },
    maxWidth: 1280,
  },
  sizes: {
    // The longest line of running text.
    measure: 640,
  },
  // A terminal: near-black, white text, and a green prompt.
  colors: {
    page: "#0b0b0b",
    ink: "#f5f5f5",
    dim: "#a3a3a3",
    accent: "#57d68d",
    rule: "#2a2a2a",
    well: "#171717",
  },
  fonts: {
    sans: {
      family: "-apple-system",
      fallback: 'BlinkMacSystemFont, "Inter", "Segoe UI", sans-serif',
    },
    mono: {
      family: "ui-monospace",
      fallback: 'Menlo, Consolas, "Courier New", monospace',
    },
  },
  type: {
    display: {
      font: "sans",
      size: { mobile: 44, desktop: 72 },
      lineHeight: 1,
      letterSpacing: "-0.035em",
      weight: 700,
    },
    title: {
      font: "sans",
      size: { mobile: 28, desktop: 36 },
      lineHeight: 1.1,
      letterSpacing: "-0.025em",
      weight: 700,
    },
    lead: {
      font: "sans",
      size: { mobile: 20, desktop: 24 },
      lineHeight: 1.35,
      letterSpacing: "-0.01em",
      weight: 400,
    },
    body: {
      font: "sans",
      size: 17,
      lineHeight: 1.5,
      letterSpacing: "0em",
      weight: 400,
    },
    button: {
      font: "sans",
      size: 17,
      lineHeight: 1.2,
      letterSpacing: "-0.01em",
      weight: 600,
    },
    note: {
      font: "sans",
      size: 15,
      lineHeight: 1.4,
      letterSpacing: "0em",
      weight: 400,
    },
    code: {
      font: "mono",
      size: 15,
      lineHeight: 1.5,
      letterSpacing: "0em",
      weight: 400,
    },
  },
});
