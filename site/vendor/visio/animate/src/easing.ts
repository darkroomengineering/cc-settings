import { cubicBezier } from "animejs/easings/cubic-bezier";

const CUBIC_BEZIER =
  /^cubic-bezier\(\s*(?<x1>-?[\d.]+)\s*,\s*(?<y1>-?[\d.]+)\s*,\s*(?<x2>-?[\d.]+)\s*,\s*(?<y2>-?[\d.]+)\s*\)$/v;

/** The anime.js easing of a `cubic-bezier(...)` easing token, so a tween and a CSS transition follow one curve. */
export function easing(token: {
  readonly value: string;
}): ReturnType<typeof cubicBezier> {
  const groups = CUBIC_BEZIER.exec(token.value.trim())?.groups;

  if (!groups) {
    throw new Error(
      `[@visio/animate] easing() takes a cubic-bezier(...) token, got ${JSON.stringify(token.value)}. Write the token as cubic-bezier(x1, y1, x2, y2) in src/styles/tokens.ts.`
    );
  }

  return cubicBezier(
    Number(groups.x1),
    Number(groups.y1),
    Number(groups.x2),
    Number(groups.y2)
  );
}
