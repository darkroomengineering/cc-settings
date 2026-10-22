"""Shared helpers for the per-chapter turntables + clay/wire/bake breakdowns (Blender 3.1, EEVEE).

Builds on common.py (unlit site material, camera helpers). Adds:
  * stage materials (clay / wire / bake) that all share the same hard alpha clip (0.25) + optional ragged disc crop
  * visible-surface point sampling (alpha-tested) for accurate auto-framing
  * closed-form "distance needed to fit" per azimuth + smooth periodic distance profile for seamless turntables
  * still (transparent + dark) and turntable (RGBA png -> dark H.264) output helpers
"""
import bpy, sys, os, math, subprocess, shutil
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
from common import *

CH_OUT = OUT + "chapters/"
FFMPEG = shutil.which("ffmpeg") or "/opt/homebrew/bin/ffmpeg"
FFPROBE = shutil.which("ffprobe") or "/opt/homebrew/bin/ffprobe"
BG_HEX = "0b0f0a"
N_TT = 192            # 8 s @ 24 fps
W, H = 1920, 1080
SENSOR = 36.0

WIRE_BASE = (0.035, 0.04, 0.038)      # same palette as landscape_scene.terrain_wire_mat
WIRE_LINE = (0.55, 0.62, 0.58)
CLAY_RGB = (0.5, 0.49, 0.47)


def get_argv():
    return sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []


# ----------------------------------------------------------------------------------------------- materials
def _opaque_fac(nt, alpha_path, clip, crop):
    """Socket that is 1 where the surface is kept, 0 where cut (hard). None if fully opaque."""
    fac = None
    if alpha_path:
        atex = nt.nodes.new("ShaderNodeTexImage")
        atex.image = load_img(alpha_path, non_color=True)
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = clip
        nt.links.new(atex.outputs["Color"], gt.inputs[0])
        fac = gt.outputs[0]
    if crop:
        cx, cy, r, rag = crop["cx"], crop["cy"], crop["r"], crop.get("rag", 0.06)
        geo = nt.nodes.new("ShaderNodeNewGeometry")
        sub = nt.nodes.new("ShaderNodeVectorMath"); sub.operation = "SUBTRACT"
        sub.inputs[1].default_value = (cx, cy, 0.0)
        nt.links.new(geo.outputs["Position"], sub.inputs[0])
        flat = nt.nodes.new("ShaderNodeVectorMath"); flat.operation = "MULTIPLY"
        flat.inputs[1].default_value = (1.0, 1.0, 0.0)
        nt.links.new(sub.outputs[0], flat.inputs[0])
        ln = nt.nodes.new("ShaderNodeVectorMath"); ln.operation = "LENGTH"
        nt.links.new(flat.outputs[0], ln.inputs[0])
        # ragged, organic edge: radius modulated by world-space noise
        noise = nt.nodes.new("ShaderNodeTexNoise")
        noise.inputs["Scale"].default_value = 3.0 / r
        noise.inputs["Detail"].default_value = 1.0   # >1 octaves alias into blocky semi-transparent patches in EEVEE
        nt.links.new(geo.outputs["Position"], noise.inputs["Vector"])
        mad = nt.nodes.new("ShaderNodeMath"); mad.operation = "MULTIPLY_ADD"
        mad.inputs[1].default_value = 2 * rag * r
        mad.inputs[2].default_value = r - rag * r
        nt.links.new(noise.outputs["Fac"], mad.inputs[0])
        lt = nt.nodes.new("ShaderNodeMath"); lt.operation = "LESS_THAN"
        nt.links.new(ln.outputs["Value"], lt.inputs[0])
        nt.links.new(mad.outputs[0], lt.inputs[1])
        if fac is None:
            fac = lt.outputs[0]
        else:
            mul = nt.nodes.new("ShaderNodeMath"); mul.operation = "MULTIPLY"
            nt.links.new(fac, mul.inputs[0]); nt.links.new(lt.outputs[0], mul.inputs[1])
            fac = mul.outputs[0]
    return fac


def _finish(mat, nt, shader_out, fac, shadow_clip):
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    if fac is not None:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(fac, mix.inputs["Fac"])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(shader_out, mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        mat.blend_method = "CLIP"
        mat.alpha_threshold = 0.5
        mat.shadow_method = "CLIP" if shadow_clip else "NONE"
    else:
        nt.links.new(shader_out, out.inputs["Surface"])
        mat.blend_method = "OPAQUE"
        mat.shadow_method = "OPAQUE" if shadow_clip else "NONE"
    mat.use_backface_culling = False
    return mat


FOG = None   # optional (near, far, srgb_hex): three.js linear Fog = mix(col, fogCol, smoothstep(near, far, viewDepth))


def bake_mat(name, color, alpha=None, clip=0.25, crop=None, interp="Linear", strength=1.0):
    """Site look: Emission(strength 1) <- baked sRGB texture, alpha map hard-clipped at 0.25 (= alphaTest)."""
    mat = bpy.data.materials.new(name + "_bake")
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    tex = nt.nodes.new("ShaderNodeTexImage"); tex.image = load_img(color); tex.interpolation = interp
    emi = nt.nodes.new("ShaderNodeEmission"); emi.inputs["Strength"].default_value = strength
    col = tex.outputs["Color"]
    if FOG:
        near, far, hx = FOG
        cd = nt.nodes.new("ShaderNodeCameraData")
        mr = nt.nodes.new("ShaderNodeMapRange"); mr.interpolation_type = "SMOOTHSTEP"
        mr.inputs["From Min"].default_value = near; mr.inputs["From Max"].default_value = far
        nt.links.new(cd.outputs["View Z Depth"], mr.inputs["Value"])
        mx = nt.nodes.new("ShaderNodeMixRGB"); mx.inputs["Color2"].default_value = (*hex_lin(hx), 1)
        nt.links.new(mr.outputs["Result"], mx.inputs["Fac"]); nt.links.new(col, mx.inputs["Color1"])
        col = mx.outputs["Color"]
    nt.links.new(col, emi.inputs["Color"])
    return _finish(mat, nt, emi.outputs[0], _opaque_fac(nt, alpha, clip, crop), shadow_clip=False)


def clay_mat(name, alpha=None, clip=0.25, crop=None, rgb=CLAY_RGB, rough=0.6):
    mat = bpy.data.materials.new(name + "_clay")
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular"].default_value = 0.3
    return _finish(mat, nt, b.outputs[0], _opaque_fac(nt, alpha, clip, crop), shadow_clip=True)


def wire_mat(name, alpha=None, clip=0.25, crop=None, px=0.6, base=CLAY_RGB, line=None, line_strength=1.0):
    """Lit clay base + flat dark triangle edges (shader Wireframe, pixel-sized) -- same look as the hero wire stills."""
    line = line or hex_lin("#141c17")
    mat = bpy.data.materials.new(name + "_wire")
    mat.use_nodes = True
    nt = mat.node_tree; nt.nodes.clear()
    b = nt.nodes.new("ShaderNodeBsdfPrincipled")
    b.inputs["Base Color"].default_value = (*base, 1)
    b.inputs["Roughness"].default_value = 0.6
    b.inputs["Specular"].default_value = 0.3
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (*line, 1)
    emi.inputs["Strength"].default_value = line_strength
    wf = nt.nodes.new("ShaderNodeWireframe"); wf.use_pixel_size = True; wf.inputs["Size"].default_value = px
    mix = nt.nodes.new("ShaderNodeMixShader")
    nt.links.new(wf.outputs[0], mix.inputs["Fac"])
    nt.links.new(b.outputs[0], mix.inputs[1])
    nt.links.new(emi.outputs[0], mix.inputs[2])
    return _finish(mat, nt, mix.outputs[0], _opaque_fac(nt, alpha, clip, crop), shadow_clip=True)


def apply_stage(parts, stage, **kw):
    """parts: list of dicts {ob, color, alpha, interp, strength, crop, mat_fn(optional)}.
    stage: bake | clay | clay_raw | wire | wire_raw  (_raw = ignore alpha maps: shows the bare cards)."""
    cache = {}
    for p in parts:
        alpha = None if stage.endswith("_raw") else p.get("alpha")
        crop = p.get("crop")
        key = (p["color"], alpha, stage, p.get("strength", 1.0), str(crop))
        if key not in cache:
            nm = os.path.splitext(os.path.basename(p["color"]))[0][:24]
            if stage == "bake":
                cache[key] = p["bake_fn"]() if p.get("bake_fn") else bake_mat(nm, p["color"], alpha, crop=crop, interp=p.get("interp", "Linear"), strength=p.get("strength", 1.0))
            elif stage.startswith("clay"):
                cache[key] = clay_mat(nm, alpha, crop=crop)
            else:
                cache[key] = wire_mat(nm, alpha, crop=crop, px=kw.get("wire_px", 0.6))
        assign(p["ob"], cache[key])


# ----------------------------------------------------------------------------------------------- point sampling
_IMG_CACHE = {}


def _alpha_array(path):
    if path not in _IMG_CACHE:
        img = load_img(path, non_color=True)
        w, h = img.size
        a = np.empty(w * h * 4, dtype=np.float32)
        img.pixels.foreach_get(a)
        _IMG_CACHE[path] = a.reshape(h, w, 4)[:, :, 0].copy()
    return _IMG_CACHE[path]


def visible_points(ob, alpha=None, clip=0.25, n=40000, crop=None, seed=1):
    """Area-weighted random surface samples (world space) that survive the alpha clip / crop."""
    dg = bpy.context.evaluated_depsgraph_get()
    eo = ob.evaluated_get(dg)
    me = eo.to_mesh()
    me.calc_loop_triangles()
    nt = len(me.loop_triangles)
    co = np.empty(len(me.vertices) * 3, np.float32); me.vertices.foreach_get("co", co); co = co.reshape(-1, 3)
    tv = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get("vertices", tv); tv = tv.reshape(-1, 3)
    tl = np.empty(nt * 3, np.int32); me.loop_triangles.foreach_get("loops", tl); tl = tl.reshape(-1, 3)
    uv = np.empty(len(me.loops) * 2, np.float32); me.uv_layers.active.data.foreach_get("uv", uv); uv = uv.reshape(-1, 2)
    M = np.array(eo.matrix_world, dtype=np.float64)
    eo.to_mesh_clear()
    wc = co @ M[:3, :3].T + M[:3, 3]
    A, B, C = wc[tv[:, 0]], wc[tv[:, 1]], wc[tv[:, 2]]
    area = 0.5 * np.linalg.norm(np.cross(B - A, C - A), axis=1)
    rng = np.random.default_rng(seed)
    idx = rng.choice(nt, size=n, p=area / area.sum())
    r1 = np.sqrt(rng.random(n))[:, None]; r2 = rng.random(n)[:, None]
    wa, wb, wcn = 1 - r1, r1 * (1 - r2), r1 * r2
    P = wa * A[idx] + wb * B[idx] + wcn * C[idx]
    keep = np.ones(n, bool)
    if alpha:
        UV = wa * uv[tl[idx, 0]] + wb * uv[tl[idx, 1]] + wcn * uv[tl[idx, 2]]
        img = _alpha_array(alpha)
        h, w = img.shape
        px = np.clip((np.mod(UV[:, 0], 1.0) * w).astype(int), 0, w - 1)
        py = np.clip((np.mod(UV[:, 1], 1.0) * h).astype(int), 0, h - 1)
        keep &= img[py, px] > clip
    if crop:
        d = np.hypot(P[:, 0] - crop["cx"], P[:, 1] - crop["cy"])
        keep &= d < crop["r"] * (1 - crop.get("rag", 0.06))
    return P[keep]


def parts_points(parts, n=40000):
    pts = [visible_points(p["ob"], p.get("alpha"), n=p.get("n", n), crop=p.get("crop")) for p in parts if not p["ob"].hide_render]
    return np.concatenate(pts, axis=0)


# ----------------------------------------------------------------------------------------------- framing
def _basis(az, el):
    a, e = math.radians(az), math.radians(el)
    d = np.array([math.cos(e) * math.cos(a), math.cos(e) * math.sin(a), math.sin(e)])  # target -> camera
    fwd = -d
    right = np.cross(fwd, [0, 0, 1.0]); right /= np.linalg.norm(right)
    up = np.cross(right, fwd)
    return fwd, right, up


def required_distance(P, T, az, el, lens, sy=0.0, mx=0.92, my=0.90, aspect=W / H):
    """Smallest camera distance (orbiting T) such that all points P project inside the
    (margin-scaled) frame. sy = vertical lens shift in tan units. Closed form per point."""
    fwd, right, up = _basis(az, el)
    Q = P - T
    x, y, z = Q @ right, Q @ up, Q @ fwd
    kx = SENSOR / 2 / lens
    ky = kx / aspect * my
    kx *= mx
    d = np.maximum(np.abs(x) / kx - z, y / (ky + sy) - z)
    d = np.maximum(d, y / (sy - ky) - z)
    return float(d.max())


def fit_profile(P, T, el, lens, n_az=180, K=2, sy=None, mx=0.92, my=0.90, mode="smooth", breathe=1.0):
    """Return (dist_fn(az), sy, stats). dist_fn is a low-harmonic periodic curve >= the needed distance
    at every azimuth (seamless by construction). If sy is None it is optimised (min mean distance)."""
    azs = np.linspace(0, 360, n_az, endpoint=False)
    kx = SENSOR / 2 / lens
    ky = kx / (W / H) * my
    if sy is None:
        best = None
        for s in np.linspace(-0.8 * ky, 0.8 * ky, 33):
            dd = np.array([required_distance(P, T, a, el, lens, s, mx, my) for a in azs[::6]])
            if best is None or dd.mean() < best[0]:
                best = (dd.mean(), s)
        sy = best[1]
    dreq = np.array([required_distance(P, T, a, el, lens, sy, mx, my) for a in azs])
    if mode == "const" or K == 0:
        coef = np.zeros(1, complex); coef[0] = dreq.max()
        fn = lambda az, c=dreq.max(): c
    else:
        F = np.fft.rfft(dreq)
        F[K + 1:] = 0
        smooth = np.fft.irfft(F, n=n_az)
        lift = (dreq - smooth).max()
        F[0] += lift * n_az
        Fk = F[:K + 1] / n_az

        def fn(az, Fk=Fk):
            t = math.radians(az)
            v = Fk[0].real
            for k in range(1, len(Fk)):
                v += 2 * (Fk[k] * complex(math.cos(k * t), math.sin(k * t))).real
            return v
    if breathe < 1.0:   # damp the dolly: blend toward the constant (max) distance -- still >= dreq everywhere
        top = max(fn(a) for a in azs)
        fn0 = fn
        fn = lambda az, fn0=fn0, top=top: breathe * fn0(az) + (1 - breathe) * top
    dprof = np.array([fn(a) for a in azs])
    fill = dreq / dprof
    stats = dict(sy=sy, shift_y=sy * lens / SENSOR, dmin=dprof.min(), dmax=dprof.max(), dreq_min=dreq.min(), dreq_max=dreq.max(),
                 fill_min=fill.min(), fill_mean=fill.mean())
    return fn, sy, stats


def place_cam(cam, T, az, el, dist):
    cam.location = orbit_point(Vector(T), dist, az, el)
    look_at(cam, Vector(T))


def new_cam(sc, lens, clip_start, clip_end, shift_y=0.0):
    cam = make_camera(sc, (0, 0, 10), (0, 0, 0), lens=lens, clip_start=clip_start, clip_end=clip_end)
    cam.data.sensor_width = SENSOR
    cam.data.sensor_fit = "HORIZONTAL"
    cam.data.shift_y = shift_y
    return cam


def key_turntable(sc, cam, T, el, az0, dist_fn, n=N_TT):
    sc.frame_start, sc.frame_end, sc.render.fps = 0, n - 1, 24
    for f in range(n):
        az = az0 + 360.0 * f / n
        place_cam(cam, T, az, el, dist_fn(az))
        cam.keyframe_insert("location", frame=f)
        cam.keyframe_insert("rotation_euler", frame=f)
    for fc in cam.animation_data.action.fcurves:
        for k in fc.keyframe_points:
            k.interpolation = "LINEAR"


# ----------------------------------------------------------------------------------------------- lights
def clay_lights(sc, T, size, cam_az, key_off=45, key_el=48, energy=3.0, ambient=0.07, cam_dist=None):
    """Sun key from camera-left/top + flat ambient world, GTAO. `size` = set extent (m) for shadow/AO scale."""
    sun = bpy.data.lights.new("key", "SUN")
    sun.energy = energy
    sun.angle = math.radians(3)
    sun.color = (1.0, 0.96, 0.9)
    sun.shadow_cascade_max_distance = (cam_dist + size) if cam_dist else size * 8   # tight range = finer cascade texels
    sun.shadow_buffer_bias = 1.5
    sun.shadow_cascade_count = 4
    sun.shadow_cascade_fade = 0.1
    sun.use_contact_shadow = size <= 10       # screen-space contact shadows band at the crop edge on big sets
    sun.contact_shadow_distance = size * 0.01
    so = bpy.data.objects.new("key", sun)
    sc.collection.objects.link(so)
    so.location = orbit_point(Vector(T), size, cam_az + key_off, key_el)
    look_at(so, Vector(T))
    e = sc.eevee
    e.shadow_cascade_size = "4096"
    e.use_soft_shadows = True
    e.use_gtao = True
    e.gtao_distance = min(size * 0.03, 0.4)
    e.gtao_factor = 1.0
    bg_world(sc, (ambient, ambient * 1.07, ambient * 1.07), 1.0)
    return so


def unlit_world(sc):
    bg_world(sc, (0, 0, 0), 0.0)


# ----------------------------------------------------------------------------------------------- output
def composite_dark(src, dst, size=f"{W}x{H}", bg=None):
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x{bg or BG_HEX}:s={size},format=rgb24",
                    "-i", src, "-filter_complex", "[0][1]overlay=format=rgb,format=rgb24", "-frames:v", "1", dst], check=True)


def render_still(sc, path_png):
    """Transparent PNG + same image composited over #0b0f0a as *_dark.png."""
    sc.render.film_transparent = True
    sc.render.image_settings.color_mode = "RGBA"
    sc.render.filepath = path_png
    bpy.ops.render.render(write_still=True)
    composite_dark(path_png, path_png.replace(".png", "_dark.png"))


def encode_turntable(pattern, out, n=N_TT, crf=18, bg=None):
    tags = ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709"]
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", "-f", "lavfi", "-i", f"color=c=0x{bg or BG_HEX}:s={W}x{H}:r=24,format=rgb24",
                    "-framerate", "24", "-start_number", "0", "-i", pattern,
                    "-filter_complex", "[0][1]overlay=format=rgb:shortest=1,scale=out_color_matrix=bt709:out_range=tv,format=yuv420p",
                    "-frames:v", str(n), *tags, "-c:v", "libx264", "-crf", str(crf), "-preset", "slow", "-tune", "film",
                    "-movflags", "+faststart", out], check=True)
    r = subprocess.run([FFPROBE, "-v", "error", "-show_entries", "stream=codec_name,width,height,pix_fmt,nb_frames:format=duration,size",
                        "-of", "compact", out], capture_output=True, text=True)
    print("ENCODED", out, r.stdout.strip())


def contact_sheet(paths, out, cols, tile="480x270"):
    ins = []
    for p in paths:
        ins += ["-i", p]
    n = len(paths)
    rows = (n + cols - 1) // cols
    tw, th = tile.split("x")
    f = "".join(f"[{i}]scale={tile},format=rgba[s{i}];color=c=0x{BG_HEX}:s={tile}[b{i}];[b{i}][s{i}]overlay=format=rgb[t{i}];" for i in range(n))
    layout = "|".join(f"{(i % cols) * int(tw)}_{(i // cols) * int(th)}" for i in range(n))
    f += "".join(f"[t{i}]" for i in range(n)) + f"xstack=inputs={n}:layout={layout}:fill=0x{BG_HEX}"
    subprocess.run([FFMPEG, "-y", "-loglevel", "error", *ins, "-filter_complex", f, "-frames:v", "1", out], check=True)
