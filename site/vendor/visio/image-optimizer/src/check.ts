export interface SizesCheck {
  src: string;
  /** The width `sizes` gives the image, in CSS px: its `naturalWidth`, which a cached larger copy does not change. */
  planned: number;
  /** Every `w` of the srcset the browser picked from. */
  widths: number[];
  box: { width: number; height: number };
  ratio: number;
  fit: "cover" | "contain";
  /** Whether `sizes()` was given the box's height. */
  height: boolean;
  dpr: number;
}

/** How far the planned width may be from the shown one, as a share of the width (1.5 is 2.25 times the pixels). */
const SLACK = 1.5;

/** The dev warning for a `sizes` that makes the browser pick a file too wide or too narrow for the box, or null. */
export function sizesWarning(c: SizesCheck): string | null {
  const { width, height } = c.box;
  const byHeight = c.ratio > 0 ? height * c.ratio : width;

  const shown =
    c.fit === "contain" ? Math.min(width, byHeight) : Math.max(width, byHeight);

  const sorted = c.widths.toSorted((a, b) => a - b);

  function pick(px: number) {
    return sorted.find((w) => w >= px * c.dpr) ?? sorted.at(-1) ?? 0;
  }

  const picked = pick(c.planned);
  const enough = pick(shown);

  // 2% so a box that takes the image's ratio, give or take rounding, is not limited by height.
  const limited =
    c.fit === "contain" ? byHeight < width * 0.98 : byHeight > width * 1.02;

  let fix = `Give sizes() the width the box has on each screen.`;

  if (limited) {
    fix = c.height
      ? `The box's height decides its width: give sizes() the height the box has on each screen.`
      : `The box's height decides its width: give sizes() the box's height, sizes(width, { height }) (the images skill).`;
  }

  const start = `[@visio/image-optimizer] <Image> ${c.src} shows ${Math.round(shown)} px wide, but its sizes plans for ${Math.round(c.planned)} px`;

  if (picked > enough && c.planned > shown * SLACK) {
    return `${start}, so the browser picks the ${picked} px file where the ${enough} px file is enough at ${c.dpr}x. ${fix}`;
  }

  if (picked < enough && c.planned < shown / SLACK) {
    return `${start}, so the browser picks the ${picked} px file, which is blurry at ${c.dpr}x: it needs the ${enough} px file. ${fix}`;
  }

  return null;
}

const CANDIDATE = /^(?<url>\S+)\s+(?<w>\d+)w$/v;

/** The `w` of each candidate in a srcset, by its absolute URL. */
function candidates(srcset: string): Map<string, number> {
  const out = new Map<string, number>();

  for (const part of srcset.split(/,\s+/v)) {
    const groups = CANDIDATE.exec(part.trim())?.groups;

    if (groups?.url && groups.w) {
      out.set(new URL(groups.url, document.baseURI).href, Number(groups.w));
    }
  }

  return out;
}

const warned = new Set<string>();

/** In dev, warns once per image and `sizes` when `sizes` does not fit the box the image shows in. */
export function watchSizes(
  img: HTMLImageElement,
  fit: () => "cover" | "contain",
  ratio: () => number,
  height: () => boolean
) {
  function check() {
    const key = `${img.getAttribute("src")} ${img.sizes}`;

    // A box 0 px wide or high is closed or hidden, and shows nothing yet.
    if (
      !img.currentSrc ||
      img.naturalWidth === 0 ||
      img.clientWidth === 0 ||
      img.clientHeight === 0 ||
      warned.has(key)
    ) {
      return;
    }

    const sets = [
      ...(img.parentElement?.querySelectorAll("source") ?? []),
      img,
    ].map((el) => candidates(el.srcset));

    const set = sets.find((s) => s.has(img.currentSrc));

    if (!set) {
      return;
    }

    const message = sizesWarning({
      src: new URL(img.currentSrc).pathname,
      planned: img.naturalWidth,
      widths: [...set.values()],
      box: { width: img.clientWidth, height: img.clientHeight },
      ratio: ratio(),
      fit: fit(),
      height: height(),
      dpr: devicePixelRatio,
    });

    if (message) {
      warned.add(key);
      console.warn(message);
    }
  }

  // The ref runs before the element is laid out, and a cached file is complete already.
  img.addEventListener("load", () => setTimeout(check, 0));
  setTimeout(() => img.complete && check(), 0);
}
