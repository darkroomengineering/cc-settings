"""Attribute a route's shipped JavaScript to packages and app directories.

Answers "where do the bytes come from" per chunk and in total, from source
maps. Works on any bundler that emits `sourceMappingURL` comments; the
Next.js/Turbopack path is the tested one.

Usage (Next.js):
  1. Build once with browser source maps:
       productionBrowserSourceMaps: true  (next.config, revert after)
  2. python3 bundle-attribution.py .next/server/app/index.html .next/static/chunks

Any HTML file works as the first argument; every `<script src>` under the
chunk directory is attributed. Chunks marked `noModule` (legacy polyfills a
modern browser never fetches) are skipped. Sizes are raw and gzip level 6.

Reading the output: `npm:react-dom (via next)` and `npm:next/...` are the
framework floor; `app:/...` buckets are what the project controls. Refine
`bucket()` when a repo has its own conventions (monorepo packages, vendored
code).
"""

import collections
import gzip
import json
import os
import re
import sys

B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"


def vlq(segment):
    out, shift, val = [], 0, 0
    for c in segment:
        d = B64.index(c)
        val |= (d & 31) << shift
        shift += 5
        if not d & 32:
            out.append(-(val >> 1) if val & 1 else val >> 1)
            val = shift = 0
    return out


def attribute(js_path):
    js = open(js_path, "rb").read()
    m = re.search(rb"sourceMappingURL=(\S+)", js)
    if not m:
        return None, len(js), len(gzip.compress(js, 6))
    smap = json.load(open(os.path.join(os.path.dirname(js_path), m.group(1).decode())))
    lines, srcs = js.split(b"\n"), smap["sources"]
    per, sidx = collections.Counter(), 0
    for li, seg_line in enumerate(smap["mappings"].split(";")):
        if li >= len(lines):
            break
        line, cols, gcol = lines[li], [], 0
        for seg in seg_line.split(","):
            if not seg:
                continue
            f = vlq(seg)
            gcol += f[0]
            if len(f) > 1:
                sidx += f[1]
            cols.append((gcol, sidx if len(f) > 1 else None))
        for k, (c, s) in enumerate(cols):
            end = cols[k + 1][0] if k + 1 < len(cols) else len(line)
            per[srcs[s] if s is not None else "<unmapped>"] += max(0, end - c)
        per["<unmapped>"] += cols[0][0] if cols else len(line)
    return per, len(js), len(gzip.compress(js, 6))


def bucket(src):
    src = re.sub(r"^turbopack://", "", src).replace("[project]/", "")
    m = re.search(r"node_modules/next/dist/compiled/((?:@[^/]+/)?[^/]+)", src)
    if m:
        return f"npm:{m.group(1)} (via next)"
    m = re.search(r"node_modules/next/dist/(?:esm/)?(?:client|shared)/([^/]+/[^/]+)", src)
    if m:
        return f"npm:next/{m.group(1)}"
    m = re.search(r"node_modules/((?:@[^/]+/)?[^/]+)", src)
    if m:
        return f"npm:{m.group(1)}"
    if not src or src == "<unmapped>":
        return "<unmapped>"
    return "app:" + "/".join(src.split("/")[:3])


def main(html_path, chunk_dir):
    html = open(html_path).read()
    chunks = []
    for m in re.finditer(r'<script[^>]*src="([^"]+\.js)"[^>]*>', html):
        if "noModule" in m.group(0):
            continue
        name = m.group(1).split("/")[-1]
        p = os.path.join(chunk_dir, name)
        if os.path.exists(p) and p not in chunks:
            chunks.append(p)
    total, rows, gz_total = collections.Counter(), [], 0
    for p in chunks:
        per, raw, gz = attribute(p)
        gz_total += gz
        b = collections.Counter()
        if per:
            for s, n in per.items():
                b[bucket(s)] += n
                total[bucket(s)] += n
        rows.append((os.path.basename(p), raw, gz, b))
    for name, raw, gz, b in sorted(rows, key=lambda r: -r[2]):
        print(f"\n{name}  raw {raw / 1024:.1f} KB  gz {gz / 1024:.1f} KB" + ("" if b else "  (no source map)"))
        for k, v in b.most_common(8):
            print(f"   {v / 1024:7.1f} KB  {k}")
    print(f"\n== {len(chunks)} chunks, {gz_total / 1024:.1f} KB gz total; raw bytes by bucket")
    for k, v in total.most_common(40):
        print(f"{v / 1024:8.1f} KB  {k}")


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("usage: bundle-attribution.py <rendered.html> <chunk-dir>")
    main(sys.argv[1], sys.argv[2])
