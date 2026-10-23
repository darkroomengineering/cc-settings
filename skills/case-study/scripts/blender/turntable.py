"""Generic turntable + clay/wire/bake breakdown for any glTF set. No per-project code needed for the common cases.

usage: Blender -b --factory-startup -P turntable.py -- --glb a.glb [--glb b.glb ...] --name NAME --job probe|stills|turntable
         [--tex "MESH_SUBSTRING=color.png[:alpha.png]" ...] [--el 15] [--lens 50] [--hero-az 30] [--hero-el 15]
         [--samples 64] [--frames 192] [--breathe 0.5] [--look auto|bake|material]
         [--pbr "MESH_SUBSTRING=path/prefix_"] [--hdri studio|city|forest|… or a .exr/.hdr path] [--hdri-strength 1.0]
env:   CS_SITE (base for relative paths), CS_OUT (output root), CS_BG (hex ground for *_dark and the mp4)

Textures, per mesh, first match wins:
  1. --tex mappings (for GLBs shipped without materials whose baked textures the site loads in code; map by mesh name substring)
  2. the mesh's own glTF base-colour texture (embedded images are written out as PNG; RGBA alpha becomes a greyscale alpha map)
  3. a flat swatch of its base colour
--pbr builds a lit Principled material from a texture set the site loads in code (prefix + BaseColor/Albedo, Metallic/Metalness,
Roughness, Normal, Height/Displacement; .png/.jpg/.webp), e.g. --pbr "Ltr=assets/textures/Model_Letters_". Lit looks use an HDRI for
reflections (default: Blender's bundled studio.exr), which metals need.
Output: $CS_OUT/NAME/{01_clay,02_wire,03_bake}.png (+ _dark.png), turntable_360.mp4 (+ turntable_png/), probe -> NAME/_probe_*.png
Third stage ("look"): bake = unlit emission of the texture, right for sites that draw baked lighting with MeshBasicMaterial;
material = the GLB's own PBR materials under the studio key light, right for lit sites. auto = bake when every mesh got a --tex map, else material.
"""
import bpy, sys, os, math, time
import numpy as np
from mathutils import Vector
sys.path.insert(0, os.path.dirname(__file__))
from chapters_lib import *


def args():
    a = get_argv()
    out = {"glb": [], "tex": [], "job": "probe", "name": "set", "el": 15.0, "lens": 50.0, "hero_az": 30.0, "hero_el": 15.0,
           "samples": 64, "frames": N_TT, "breathe": 0.5, "look": "auto", "pbr": [], "hdri": "studio", "hdri_strength": 1.0}
    i = 0
    while i < len(a):
        k = a[i].lstrip("-").replace("-", "_"); v = a[i + 1] if i + 1 < len(a) else None
        if k in ("glb", "tex", "pbr"):
            out[k].append(v)
        elif k in ("el", "lens", "hero_az", "hero_el", "breathe", "hdri_strength"):
            out[k] = float(v)
        elif k in ("samples", "frames"):
            out[k] = int(v)
        else:
            out[k] = v
        i += 2
    return out


A = args()
OD = OUT + A["name"] + "/"
TEXD = OD + "_tex/"
os.makedirs(TEXD, exist_ok=True)
t0 = time.time()


def rel(p):
    return p if os.path.isabs(p) else SITE + p


def write_png(img, path):
    """Save any Blender image (packed / embedded in the GLB, or external) as a PNG file and return the path."""
    if img.filepath and os.path.exists(bpy.path.abspath(img.filepath)) and not img.packed_file:
        return bpy.path.abspath(img.filepath)
    img.filepath_raw = path
    img.file_format = "PNG"
    img.save()
    return path


def alpha_png(img, path):
    """Greyscale PNG of an RGBA image's alpha channel, or None if fully opaque."""
    if img.channels < 4:
        return None
    px = np.empty(img.size[0] * img.size[1] * 4, dtype=np.float32)
    img.pixels.foreach_get(px)
    a = px[3::4]
    if a.min() > 0.99:
        return None
    out = bpy.data.images.new(os.path.basename(path), img.size[0], img.size[1], alpha=False)
    g = np.repeat(a, 4); g[3::4] = 1.0
    out.pixels.foreach_set(g)
    out.filepath_raw = path; out.file_format = "PNG"; out.save()
    return path


def swatch(rgb, path):
    img = bpy.data.images.new(os.path.basename(path), 4, 4, alpha=False)
    img.pixels.foreach_set(np.tile(np.array([*rgb[:3], 1.0], dtype=np.float32), 16))
    img.filepath_raw = path; img.file_format = "PNG"; img.save()
    return path


def own_texture(ob):
    """(color_path, alpha_path) from the mesh's glTF material: the image feeding Base Color, else any image, else a swatch."""
    for mat in [m for m in ob.data.materials if m and m.use_nodes]:
        nodes = mat.node_tree.nodes
        bsdf = next((n for n in nodes if n.type == "BSDF_PRINCIPLED"), None)
        img = None
        if bsdf and bsdf.inputs["Base Color"].is_linked:
            src = bsdf.inputs["Base Color"].links[0].from_node
            img = getattr(src, "image", None)
        img = img or next((n.image for n in nodes if n.type == "TEX_IMAGE" and n.image), None)
        safe = "".join(c if c.isalnum() else "_" for c in (img.name if img else mat.name))[:40]
        if img:
            return write_png(img, TEXD + safe + ".png"), alpha_png(img, TEXD + safe + "_alpha.png")
        if bsdf:
            return swatch(bsdf.inputs["Base Color"].default_value, TEXD + safe + "_swatch.png"), None
    return swatch((0.6, 0.6, 0.6), TEXD + "grey_swatch.png"), None


SUFFIX = {"base": ("basecolor", "base_color", "albedo", "diffuse", "color"), "metal": ("metallic", "metalness", "metal"),
          "rough": ("roughness", "rough"), "normal": ("normal", "nrm", "normalgl"), "height": ("height", "displacement", "disp", "bump")}


def pbr_files(prefix):
    d, stem = os.path.dirname(rel(prefix)), os.path.basename(prefix).lower()
    found = {}
    for f in sorted(os.listdir(d)):
        low = f.lower()
        if not low.startswith(stem) or not low.endswith((".png", ".jpg", ".jpeg", ".webp")):
            continue
        tail = os.path.splitext(low[len(stem):])[0].strip("_- ")
        for key, names in SUFFIX.items():
            if key not in found and tail in names:
                found[key] = os.path.join(d, f)
    return found


def pbr_material(name, files):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    bsdf = next(n for n in nt.nodes if n.type == "BSDF_PRINCIPLED")
    def tex(path, non_color):
        t = nt.nodes.new("ShaderNodeTexImage"); t.image = load_img(path, non_color=non_color); return t
    if "base" in files:
        nt.links.new(tex(files["base"], False).outputs["Color"], bsdf.inputs["Base Color"])
    if "metal" in files:
        nt.links.new(tex(files["metal"], True).outputs["Color"], bsdf.inputs["Metallic"])
    if "rough" in files:
        nt.links.new(tex(files["rough"], True).outputs["Color"], bsdf.inputs["Roughness"])
    nrm = None
    if "normal" in files:
        nrm = nt.nodes.new("ShaderNodeNormalMap")
        nt.links.new(tex(files["normal"], True).outputs["Color"], nrm.inputs["Color"])
    if "height" in files:
        bump = nt.nodes.new("ShaderNodeBump"); bump.inputs["Strength"].default_value = 0.15
        nt.links.new(tex(files["height"], True).outputs["Color"], bump.inputs["Height"])
        if nrm:
            nt.links.new(nrm.outputs["Normal"], bump.inputs["Normal"])
        nrm = bump
    if nrm:
        nt.links.new(nrm.outputs["Normal"], bsdf.inputs["Normal"])
    return mat


def hdri_world(sc, which, strength):
    """Environment for lit looks: a bundled Blender studio light by name, or a .exr/.hdr path."""
    path = which if os.path.isfile(str(which)) else os.path.join(bpy.utils.system_resource("DATAFILES", path="studiolights/world"), f"{which}.exr")
    if not os.path.isfile(path):
        return False
    sc.world.use_nodes = True
    nt = sc.world.node_tree
    env = nt.nodes.new("ShaderNodeTexEnvironment"); env.image = bpy.data.images.load(path, check_existing=True)
    bg = nt.nodes["Background"]; bg.inputs["Strength"].default_value = strength
    nt.links.new(env.outputs["Color"], bg.inputs["Color"])
    return True


# ---------------------------------------------------------------------------------------------- build
sc = reset()
for g in A["glb"]:
    import_glb(rel(g))
maps = []
for t in A["tex"]:
    key, files = t.split("=", 1)
    color, _, alpha = files.partition(":")
    maps.append((key, rel(color), rel(alpha) if alpha else None))
parts = []
PBR = [(k, pbr_files(v)) for k, v in (x.split("=", 1) for x in A["pbr"])]
for k, f in PBR:
    print("PBR", k, {kk: os.path.basename(vv) for kk, vv in f.items()})
PBR_MATS = {}
ORIG = {}   # the glTF's own materials (or the --pbr material), for the "material" look
for ob in [o for o in bpy.data.objects if o.type == "MESH"]:
    ORIG[ob.name] = [m for m in ob.data.materials]
    pb = next((x for x in PBR if x[0] in ob.name and x[1]), None)
    if pb:
        PBR_MATS.setdefault(pb[0], pbr_material("pbr_" + pb[0], pb[1]))
        ORIG[ob.name] = [PBR_MATS[pb[0]]]
    m = next((x for x in maps if x[0] in ob.name), None)
    color, alpha = (m[1], m[2]) if m else ((pb[1].get("base"), None) if pb and pb[1].get("base") else own_texture(ob))
    ob.data.calc_loop_triangles()
    parts.append({"ob": ob, "color": color, "alpha": alpha, "mapped": bool(m)})
    print(f"PART {ob.name}: verts {len(ob.data.vertices)} tris {len(ob.data.loop_triangles)} tex {os.path.basename(color)}" + (f" alpha {os.path.basename(alpha)}" if alpha else ""))
if not parts:
    sys.exit("no meshes imported")
LOOK = A["look"] if A["look"] != "auto" else ("bake" if all(p["mapped"] for p in parts) else "material")
print("LOOK", LOOK)

# keep imported animations looping across the turntable (glTF actions start at frame 0)
for ob in bpy.data.objects:
    ad = ob.animation_data
    if ad and ad.action:
        for fc in ad.action.fcurves:
            if not any(md.type == "CYCLES" for md in fc.modifiers):
                fc.modifiers.new("CYCLES")

# ---------------------------------------------------------------------------------------------- framing
P = parts_points(parts)
T = Vector(((P.min(0) + P.max(0)) / 2).tolist())
size = float(np.linalg.norm(P.max(0) - P.min(0)))
el, lens = A["el"], A["lens"]
cam = new_cam(sc, lens, max(size * 1e-3, 0.001), size * 100)
tt_fn, tt_sy, stats = fit_profile(P, T, el, lens, K=2, breathe=A["breathe"])
best = min((required_distance(P, T, A["hero_az"], A["hero_el"], lens, s, 0.94, 0.92), s)
           for s in np.linspace(-0.6, 0.6, 41) * (SENSOR / 2 / lens) / (W / H))
hero_d, hero_sy = best
print("FRAMING", {k: round(float(v), 3) for k, v in stats.items()}, "hero_dist", round(hero_d, 3), "size", round(size, 3))


def stage(st):
    if st == "material":
        for p in parts:
            p["ob"].data.materials.clear()
            for m in ORIG[p["ob"].name]:
                p["ob"].data.materials.append(m)
    else:
        apply_stage(parts, st)
    for o in [o for o in bpy.data.objects if o.type == "LIGHT"]:
        bpy.data.objects.remove(o)
    if st == "bake":
        unlit_world(sc)
        setattr_safe(sc.eevee, "use_gtao", False)
    else:
        clay_lights(sc, T, size, A["hero_az"], cam_dist=hero_d)
        if st == "material":
            hdri_world(sc, A["hdri"], A["hdri_strength"])   # reflections for metals; background stays transparent


def hero():
    cam.animation_data_clear()
    cam.data.shift_y = hero_sy * lens / SENSOR
    place_cam(cam, T, A["hero_az"], A["hero_el"], hero_d)


setup_eevee(sc, W, H, samples=A["samples"], transparent=True)
sc.frame_set(0)

if A["job"] == "probe":
    sc.render.resolution_percentage = 25
    sc.eevee.taa_render_samples = 16
    stage(LOOK)
    cam.data.shift_y = tt_sy * lens / SENSOR
    shots = []
    for az in range(0, 360, 45):
        place_cam(cam, T, A["hero_az"] + az, el, tt_fn(A["hero_az"] + az))
        sc.render.filepath = OD + f"_probe_tt{az:03d}.png"
        bpy.ops.render.render(write_still=True)
        shots.append(sc.render.filepath)
    contact_sheet(shots, OD + "_probe_turntable.png", cols=4)
    hero()
    hs = []
    for st in ("clay", "wire", LOOK):
        stage(st)
        sc.render.filepath = OD + f"_probe_hero_{st}.png"
        bpy.ops.render.render(write_still=True)
        hs.append(sc.render.filepath)
    contact_sheet(hs, OD + "_probe_hero.png", cols=3, tile="640x360")
    print("PROBE", OD + "_probe_turntable.png", OD + "_probe_hero.png")

elif A["job"] == "stills":
    hero()
    for st, nm in (("clay", "01_clay"), ("wire", "02_wire"), (LOOK, "03_" + LOOK)):
        stage(st)
        sc.eevee.taa_render_samples = A["samples"] if st == "bake" else max(A["samples"], 96)
        render_still(sc, OD + nm + ".png")
        print("STILL", OD + nm + ".png", round(time.time() - t0, 1), "s")

elif A["job"] == "turntable":
    n = A["frames"]
    stage(LOOK)
    cam.data.shift_y = tt_sy * lens / SENSOR
    key_turntable(sc, cam, T, el, A["hero_az"], tt_fn, n=n)
    os.makedirs(OD + "turntable_png", exist_ok=True)
    sc.render.filepath = OD + "turntable_png/tt_"
    sc.render.image_settings.color_mode = "RGBA"
    bpy.ops.render.render(animation=True)
    encode_turntable(OD + "turntable_png/tt_%04d.png", OD + "turntable_360.mp4", n=n)

print("DONE", A["job"], round(time.time() - t0, 1), "s")
