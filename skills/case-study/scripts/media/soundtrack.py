"""Rebuild a site's ambience mix for any scroll path from the Theatre.js volume keyframes it ships, plus timed one-shots.
usage: python3 -I soundtrack.py spec.json out.wav
spec: {"theatre_config": ".../public/config/X.json", "sounds_dir": ".../public/sounds", "object": "sounds",
       "duration": s, "path": [[t, scrollY], ...], "vh": 1080,
       "chapters": [{"sheet": "chapter1", "top": 0, "h": 7895}, ...],    # scroll trigger 'top bottom' -> 'bottom top'
       "oneshots": [{"id": "Sfx_Intro_Whoosh", "t": 0.0, "gain": 1.0}], "target_rms_db": -20}
Track prop paths are the stem file names (e.g. ["Sfx_Amb_Chap1_Loop"]); adapt `stem_of` if a project names them differently.
ponytail: bezier keyframes approximated as linear; fine for fades."""
import json, subprocess, sys
import numpy as np

SR = 48000
spec = json.load(open(sys.argv[1]))
cfg = json.load(open(spec['theatre_config']))
stem_of = lambda prop_path: json.loads(prop_path)[0]

def load(sid):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', f"{spec['sounds_dir']}/{sid}.wav", '-f', 'f32le', '-ac', '2', '-ar', str(SR), '-'], capture_output=True).stdout
    return np.frombuffer(raw, dtype=np.float32).reshape(-1, 2)

n = int(spec['duration'] * SR)
t = np.arange(n) / SR
pt, py = np.array(spec['path']).T
y = np.interp(t, pt, py)
mix = np.zeros((n, 2), np.float32)
vh = spec.get('vh', 1080)

for ch in spec.get('chapters', []):
    seq = cfg['sheetsById'][ch['sheet']]['sequence']
    pos = np.clip((y - (ch['top'] - vh)) / (ch['h'] + vh), 0, 1) * seq['length']
    tr = seq['tracksByObject'].get(spec.get('object', 'sounds'))
    if not tr:
        continue
    for prop, tid in tr['trackIdByPropPath'].items():
        kf = tr['trackData'][tid]['keyframes']
        gain = np.interp(pos, [k['position'] for k in kf], [k['value'] for k in kf])
        if gain.max() > 0:
            mix += np.resize(load(stem_of(prop)), (n, 2)) * gain[:, None]  # ambience stems loop on the site

for o in spec.get('oneshots', []):
    s = load(o['id']) * o.get('gain', 1.0)
    i = int(o['t'] * SR)
    s = s[: max(0, n - i)]
    mix[i : i + len(s)] += s

# site stems are often mastered very low; one static gain keeps the site's balance, the limiter catches peaks
rms_db = 20 * np.log10(np.sqrt((mix ** 2).mean()) + 1e-9)
gain_db = spec.get('target_rms_db', -20) - rms_db
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', '-', '-af', f'volume={gain_db:.1f}dB,alimiter=limit=0.89:level=false',
                '-c:a', 'pcm_s24le', sys.argv[2]], input=mix.tobytes())
print(f'{sys.argv[2]}: {spec["duration"]}s rms={rms_db:.1f}dB gain=+{gain_db:.1f}dB')
