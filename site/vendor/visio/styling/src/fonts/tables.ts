import { codePoints } from "./subset.ts";
import type { FontMetrics } from "./types.ts";

// English character frequencies from capsize (MIT). The capsize rows of
// FALLBACK_METRICS use the same weights.
const LATIN_WEIGHTS = {
  " ": 0.154,
  e: 0.0922,
  t: 0.0672,
  a: 0.0668,
  i: 0.0588,
  n: 0.0578,
  o: 0.0571,
  r: 0.0526,
  s: 0.0469,
  h: 0.0351,
  l: 0.0304,
  d: 0.0298,
  c: 0.0232,
  u: 0.0207,
  m: 0.0181,
  f: 0.017,
  p: 0.0163,
  g: 0.0155,
  y: 0.0123,
  b: 0.0114,
  w: 0.011,
  ",": 0.0083,
  ".": 0.0079,
  v: 0.0076,
  "0": 0.0053,
  k: 0.0046,
  T: 0.0041,
  S: 0.0041,
  A: 0.004,
  "|": 0.0038,
  C: 0.0031,
  "2": 0.0026,
  x: 0.0025,
  M: 0.0025,
  "1": 0.0023,
  P: 0.0023,
  I: 0.0022,
  "[": 0.0021,
  B: 0.002,
  "-": 0.0018,
  U: 0.0016,
  "5": 0.0015,
  R: 0.0015,
  F: 0.0015,
  "'": 0.0014,
  N: 0.0014,
  H: 0.0013,
  D: 0.0013,
  L: 0.0012,
  '"': 0.0012,
  W: 0.0012,
  z: 0.0011,
  G: 0.0011,
  E: 0.0011,
  "3": 0.001,
  "(": 0.001,
  ")": 0.001,
  j: 0.0009,
  J: 0.0009,
  O: 0.0009,
  "4": 0.0008,
  "8": 0.0008,
  q: 0.0008,
  ":": 0.0008,
  "6": 0.0007,
  "7": 0.0007,
  "]": 0.0007,
  K: 0.0007,
  "=": 0.0007,
  "9": 0.0006,
  V: 0.0005,
  Y: 0.0003,
  Q: 0.0001,
  $: 0.0002,
  Z: 0.0002,
  á: 0.0001,
  é: 0.0001,
  "/": 0.0001,
  "%": 0.0001,
  ";": 0.0001,
  X: 0.0001,
};

interface Table {
  offset: number;
  length: number;
}

function tag(view: DataView, at: number) {
  return String.fromCodePoint(
    view.getUint8(at),
    view.getUint8(at + 1),
    view.getUint8(at + 2),
    view.getUint8(at + 3)
  );
}

/** Table directory of the first font in the file. */
function directory(view: DataView): Map<string, Table> {
  let base = 0;

  if (tag(view, 0) === "ttcf") {
    base = view.getUint32(12);
  }

  const count = view.getUint16(base + 4);
  const tables = new Map<string, Table>();

  for (let i = 0; i < count; i += 1) {
    const at = base + 12 + i * 16;
    tables.set(tag(view, at), {
      offset: view.getUint32(at + 8),
      length: view.getUint32(at + 12),
    });
  }

  return tables;
}

function need(tables: Map<string, Table>, name: string): Table {
  const t = tables.get(name);

  if (!t) {
    throw new Error(`[@visio/styling] font has no ${name} table`);
  }

  return t;
}

/** Code point -> glyph id from the first Unicode subtable, formats 4 and 12. */
function cmap(view: DataView, table: Table): (cp: number) => number {
  const count = view.getUint16(table.offset + 2);
  let chosen: number | null = null;

  for (let i = 0; i < count; i += 1) {
    const at = table.offset + 4 + i * 8;
    const platform = view.getUint16(at);
    const encoding = view.getUint16(at + 2);

    const unicode =
      platform === 0 || (platform === 3 && (encoding === 1 || encoding === 10));

    if (!unicode) {
      continue;
    }

    const sub = table.offset + view.getUint32(at + 4);
    const format = view.getUint16(sub);

    if (format === 12) {
      chosen = sub;
      break;
    }

    if (format === 4 && chosen === null) {
      chosen = sub;
    }
  }

  if (chosen === null) {
    return () => 0;
  }

  const sub = chosen;

  if (view.getUint16(sub) === 12) {
    const groups = view.getUint32(sub + 12);

    return (cp) => {
      for (let g = 0; g < groups; g += 1) {
        const at = sub + 16 + g * 12;
        const start = view.getUint32(at);
        const end = view.getUint32(at + 4);

        if (cp >= start && cp <= end) {
          return view.getUint32(at + 8) + (cp - start);
        }
      }

      return 0;
    };
  }

  const segX2 = view.getUint16(sub + 6);
  const ends = sub + 14;
  const starts = ends + segX2 + 2;
  const deltas = starts + segX2;
  const rangeOffsets = deltas + segX2;

  return (cp) => {
    if (cp > 0xff_ff) {
      return 0;
    }

    for (let s = 0; s < segX2 / 2; s += 1) {
      const end = view.getUint16(ends + s * 2);

      if (cp > end) {
        continue;
      }

      const start = view.getUint16(starts + s * 2);

      if (cp < start) {
        return 0;
      }

      const delta = view.getInt16(deltas + s * 2);
      const rangeOffset = view.getUint16(rangeOffsets + s * 2);

      if (rangeOffset === 0) {
        return (cp + delta) & 0xff_ff;
      }

      const glyphAt = rangeOffsets + s * 2 + rangeOffset + (cp - start) * 2;
      const glyph = view.getUint16(glyphAt);

      return glyph === 0 ? 0 : (glyph + delta) & 0xff_ff;
    }

    return 0;
  };
}

function utf16(view: DataView, at: number, length: number) {
  let out = "";

  for (let i = 0; i + 1 < length; i += 2) {
    out += String.fromCodePoint(view.getUint16(at + i));
  }

  return out;
}

/** 0 for Windows US English, 1 for Unicode or Mac English, 2 for the rest. */
function rankOf(platform: number, language: number): number {
  if (platform === 3 && language === 0x04_09) {
    return 0;
  }

  if (platform === 0 || (platform === 1 && language === 0)) {
    return 1;
  }

  return 2;
}

/**
 * Typographic family (name id 16) or the plain family (id 1). Windows US
 * English wins, then Unicode or Mac English, then the first other record.
 */
function familyName(view: DataView, table: Table): string {
  const count = view.getUint16(table.offset + 2);
  const strings = table.offset + view.getUint16(table.offset + 4);
  const found = new Map<number, { rank: number; name: string }>();

  for (let i = 0; i < count; i += 1) {
    const at = table.offset + 6 + i * 12;
    const platform = view.getUint16(at);
    const language = view.getUint16(at + 4);
    const id = view.getUint16(at + 6);

    if ((id !== 16 && id !== 1) || platform > 3 || platform === 2) {
      continue;
    }

    const rank = rankOf(platform, language);
    const previous = found.get(id);

    if (previous && previous.rank <= rank) {
      continue;
    }

    const length = view.getUint16(at + 8);
    const start = strings + view.getUint16(at + 10);
    let name = "";

    if (platform === 1) {
      for (let j = 0; j < length; j += 1) {
        name += String.fromCodePoint(view.getUint8(start + j));
      }
    } else {
      name = utf16(view, start, length);
    }

    found.set(id, { rank, name });
  }

  return found.get(16)?.name ?? found.get(1)?.name ?? "";
}

/** Reads the metrics the fallback matcher needs from an OTF, TTF, or TTC file. */
export function readFontMetrics(bytes: Uint8Array): FontMetrics {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tables = directory(view);
  const head = need(tables, "head");
  const hhea = need(tables, "hhea");
  const hmtx = need(tables, "hmtx");
  const unitsPerEm = view.getUint16(head.offset + 18);

  let ascent = view.getInt16(hhea.offset + 4);
  let descent = view.getInt16(hhea.offset + 6);
  let lineGap = view.getInt16(hhea.offset + 8);
  const os2 = tables.get("OS/2");

  // fsSelection bit 7 (USE_TYPO_METRICS): browsers then use the OS/2 typo
  // metrics, not hhea.
  if (os2 && os2.length >= 74 && view.getUint16(os2.offset + 62) & 0x80) {
    ascent = view.getInt16(os2.offset + 68);
    descent = view.getInt16(os2.offset + 70);
    lineGap = view.getInt16(os2.offset + 72);
  }

  const metricCount = view.getUint16(hhea.offset + 34);

  function advance(glyph: number): number {
    return view.getUint16(hmtx.offset + Math.min(glyph, metricCount - 1) * 4);
  }

  const cmapTable = tables.get("cmap");
  const glyphOf = cmapTable ? cmap(view, cmapTable) : () => 0;
  let weighted = 0;

  for (const [ch, weight] of Object.entries(LATIN_WEIGHTS)) {
    const [cp] = codePoints(ch);

    if (cp === undefined) {
      throw new Error("[@visio/styling] a LATIN_WEIGHTS key is empty");
    }

    weighted += advance(glyphOf(cp)) * weight;
  }

  const nameTable = tables.get("name");

  return {
    familyName: nameTable ? familyName(view, nameTable) : "",
    unitsPerEm,
    ascent,
    descent,
    lineGap,
    xWidthAvg: Math.round(weighted),
  };
}
