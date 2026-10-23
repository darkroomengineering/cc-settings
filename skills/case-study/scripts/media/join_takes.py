# Join consecutive takes of one live page (a fixed take continued in a new folder) into one frame sequence + events.json:
# frames renumbered, events and logged sounds offset. usage: python3 join_takes.py <out_dir> <take_dir>:<first>:<end|all> ...
import json, os, shutil, sys
out = sys.argv[1]; os.makedirs(out, exist_ok=True)
ev, sounds, n = [], [], 0
for spec in sys.argv[2:]:
    d, a, b = spec.split(':'); a = int(a)
    meta = json.load(open(f'{d}/events.json')); b = meta['frames'] if b == 'all' else int(b)
    for f in range(a, b):
        src = f'{d}/f_{f:05d}.jpg'
        if os.path.exists(src): shutil.copy(src, f'{out}/f_{n + f - a:05d}.jpg')
    ev += [{**e, 'frame': e['frame'] - a + n, 's': round((e['frame'] - a + n) / 60, 3)} for e in meta['ev'] if a <= e['frame'] < b]
    sounds += [{**s, 'frame': s['frame'] - a + n} for s in meta.get('sounds', []) if a <= s['frame'] < b]
    n += b - a
json.dump({'ev': ev, 'sounds': sounds, 'frames': n}, open(f'{out}/events.json', 'w'), indent=1)
print(n, 'frames')
