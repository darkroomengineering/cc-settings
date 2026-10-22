"""Shared helpers for case-study offline renders (Blender 3.1+): unlit site material, scene reset, cameras."""
import bpy, math, os
from mathutils import Vector

SITE = os.environ.get("CS_SITE", os.getcwd() + "/public").rstrip("/") + "/"   # base dir for relative asset paths (often the project's public/)
MODELS = SITE + os.environ.get("CS_MODELS", "models").strip("/") + "/"         # where import_glb looks for bare file names
OUT = os.environ.get("CS_OUT", "/tmp/case-study-blender").rstrip("/") + "/"   # renders land here
BG_HEX = os.environ.get("CS_BG", "0b0f0a").lstrip("#")                         # dark ground for *_dark stills and turntables


def setattr_safe(obj, attr, value):
    """Set a property only if this Blender version has it (4.2+ removed bloom/ssr/gtao and changed blend/shadow modes)."""
    try:
        setattr(obj, attr, value)
        return True
    except (AttributeError, TypeError):
        return False


def eevee_engine():
    """'BLENDER_EEVEE' (3.x, 5.x) or 'BLENDER_EEVEE_NEXT' (4.2-4.x), whichever this build has."""
    items = bpy.types.RenderSettings.bl_rna.properties["engine"].enum_items.keys()
    return "BLENDER_EEVEE_NEXT" if "BLENDER_EEVEE_NEXT" in items else "BLENDER_EEVEE"


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    return bpy.context.scene


def import_glb(name):
    """Import a .glb/.gltf by absolute path, path relative to SITE, or bare name under MODELS. Returns {name: object} of new objects."""
    path = name if os.path.isabs(name) else (SITE + name if os.path.exists(SITE + name) else MODELS + name)
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=path)
    return {o.name: o for o in bpy.data.objects if o not in before}


def load_img(path, non_color=False):
    img = bpy.data.images.load(path, check_existing=True)
    if non_color:
        img.colorspace_settings.name = "Non-Color"
    else:
        img.colorspace_settings.name = "sRGB"
    return img


def unlit_material(name, color_path, alpha_path=None, clip=0.25, double_sided=True, interp="Linear"):
    """Emission(strength 1) fed by baked texture; optional separate greyscale alpha map, hard-clipped."""
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Strength"].default_value = 1.0
    tex = nt.nodes.new("ShaderNodeTexImage")
    tex.image = load_img(color_path)
    tex.interpolation = interp
    nt.links.new(tex.outputs["Color"], emi.inputs["Color"])
    if alpha_path:
        atex = nt.nodes.new("ShaderNodeTexImage")
        atex.image = load_img(alpha_path, non_color=True)
        gt = nt.nodes.new("ShaderNodeMath")
        gt.operation = "GREATER_THAN"
        gt.inputs[1].default_value = clip
        nt.links.new(atex.outputs["Color"], gt.inputs[0])
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        nt.links.new(gt.outputs[0], mix.inputs["Fac"])
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(emi.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        setattr_safe(mat, "blend_method", "CLIP")
        mat.alpha_threshold = 0.5
    else:
        nt.links.new(emi.outputs[0], out.inputs["Surface"])
        setattr_safe(mat, "blend_method", "OPAQUE")
    setattr_safe(mat, "shadow_method", "NONE")
    mat.use_backface_culling = not double_sided
    return mat


def flat_material(name, rgb, alpha=1.0, emission=True):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    nt = mat.node_tree
    nt.nodes.clear()
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    emi = nt.nodes.new("ShaderNodeEmission")
    emi.inputs["Color"].default_value = (*rgb, 1.0)
    if alpha < 1.0:
        tr = nt.nodes.new("ShaderNodeBsdfTransparent")
        mix = nt.nodes.new("ShaderNodeMixShader")
        mix.inputs["Fac"].default_value = alpha
        nt.links.new(tr.outputs[0], mix.inputs[1])
        nt.links.new(emi.outputs[0], mix.inputs[2])
        nt.links.new(mix.outputs[0], out.inputs["Surface"])
        setattr_safe(mat, "blend_method", "BLEND")
    else:
        nt.links.new(emi.outputs[0], out.inputs["Surface"])
    setattr_safe(mat, "shadow_method", "NONE")
    return mat


def clay_material(name="clay", rgb=(0.62, 0.60, 0.57), rough=0.65):
    mat = bpy.data.materials.new(name)
    mat.use_nodes = True
    b = mat.node_tree.nodes["Principled BSDF"]
    b.inputs["Base Color"].default_value = (*rgb, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Specular"].default_value = 0.3
    return mat


def assign(ob, mat):
    ob.data.materials.clear()
    ob.data.materials.append(mat)


def color_management(scene, look="None"):
    vs = scene.view_settings
    scene.display_settings.display_device = "sRGB"
    vs.view_transform = "Standard"
    vs.look = look
    vs.exposure = 0.0
    vs.gamma = 1.0
    scene.sequencer_colorspace_settings.name = "sRGB"


def setup_eevee(scene, w, h, samples=64, transparent=True):
    scene.render.engine = eevee_engine()
    e = scene.eevee
    e.taa_render_samples = samples
    for attr in ("use_bloom", "use_ssr", "use_gtao", "use_motion_blur"):
        setattr_safe(e, attr, False)
    setattr_safe(scene.render, "use_motion_blur", False)
    scene.render.film_transparent = transparent
    scene.render.filter_size = 1.5
    scene.render.resolution_x = w
    scene.render.resolution_y = h
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.image_settings.color_mode = "RGBA" if transparent else "RGB"
    scene.render.image_settings.color_depth = "8"
    color_management(scene)
    if scene.world is None:
        scene.world = bpy.data.worlds.new("World")
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (0, 0, 0, 1)
    bg.inputs["Strength"].default_value = 0.0


def bg_world(scene, rgb, strength=1.0):
    scene.world.use_nodes = True
    bg = scene.world.node_tree.nodes["Background"]
    bg.inputs["Color"].default_value = (*rgb, 1)
    bg.inputs["Strength"].default_value = strength


def srgb_to_lin(c):
    return c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4


def hex_lin(h):
    h = h.lstrip("#")
    return tuple(srgb_to_lin(int(h[i:i + 2], 16) / 255) for i in (0, 2, 4))


def make_camera(scene, loc, target, lens=50, clip_start=0.01, clip_end=1000, name="Cam"):
    cam_data = bpy.data.cameras.new(name)
    cam_data.lens = lens
    cam_data.clip_start = clip_start
    cam_data.clip_end = clip_end
    cam = bpy.data.objects.new(name, cam_data)
    scene.collection.objects.link(cam)
    cam.location = Vector(loc)
    look_at(cam, Vector(target))
    scene.camera = cam
    return cam


def look_at(ob, target):
    d = Vector(target) - ob.location
    ob.rotation_euler = d.to_track_quat("-Z", "Y").to_euler()


def orbit_point(center, radius, azim_deg, elev_deg):
    a = math.radians(azim_deg)
    e = math.radians(elev_deg)
    c = Vector(center)
    return c + Vector((radius * math.cos(e) * math.cos(a), radius * math.cos(e) * math.sin(a), radius * math.sin(e)))
