import { splitTop } from "./sizes.ts";

const CONDITION = /^(?<condition>\([^\)]*\)\s+)?(?<value>.+)$/v;

const CALC = /^calc\((?<inner>.*)\)$/v;

export function fitSizes(
  sizes: string,
  fit: "cover" | "contain",
  ratio: number
): string {
  if (!sizes.includes("/")) {
    return sizes;
  }

  const known = ratio > 0 && Number.isFinite(ratio);
  const fn = fit === "contain" ? "min" : "max";
  const r = Math.round(ratio * 10_000) / 10_000;

  return splitTop(sizes)
    .map((entry) => {
      const groups = CONDITION.exec(entry)?.groups;
      const [width, height] = splitTop(groups?.value ?? entry, "/");
      const condition = groups?.condition ?? "";

      if (height === undefined || width === undefined) {
        return entry;
      }

      if (!known) {
        return `${condition}${width}`;
      }

      const h = CALC.exec(height)?.groups?.inner ?? height;

      return `${condition}${fn}(${width}, calc((${h}) * ${r}))`;
    })
    .join(", ");
}
