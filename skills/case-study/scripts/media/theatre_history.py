"""Keyframe growth across dated Theatre.js state exports (a process story: how the choreography grew).
usage: python3 -I theatre_history.py <config_dir> [glob_prefix]  -> JSON lines [date-ish name, sheets, tracks, keyframes]"""
import json, os, sys
d = sys.argv[1]; pre = sys.argv[2] if len(sys.argv) > 2 else ''
rows = []
for f in sorted(x for x in os.listdir(d) if x.endswith('.json') and x.startswith(pre)):
    try: j = json.load(open(os.path.join(d, f)))
    except Exception: continue
    sheets = j.get('sheetsById') or {}
    tracks = [t for s in sheets.values() for o in ((s.get('sequence') or {}).get('tracksByObject') or {}).values() for t in o.get('trackData', {}).values()]
    if sheets: rows.append([f, len(sheets), len(tracks), sum(len(t.get('keyframes', [])) for t in tracks)])
print(json.dumps(rows))
