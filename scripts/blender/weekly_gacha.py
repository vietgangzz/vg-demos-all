"""
Weekly Gacha's machine and everything that comes out of it (src/demos/weekly-gacha), rendered with
Cycles on transparent so the app can lay them over its own world.

- machine.png   the gacha machine, straight on: a glossy saffron body on a gold plinth, a gold collar,
                and a glass dome heaped with capsules; the knob's backing plate and the chute are
                drawn, the knob itself isn't
- knob.png      the knob alone, straight on, for the app to turn: a gold disc with a pearl grip
- capsule-<colour>-top.png / -bottom.png
                a capsule's two halves, from a little above, in the same frame so they fit together;
                the bottom one's lit from inside
- item-<name>.png
                each prize turning round once, an atlas of FRAMES frames, COLS across, CELL px square
- layout.json   where the knob and the chute are on machine.png, and the knob's size, as fractions

Run headless (all of it, or just some parts):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/weekly_gacha.py -- [machine|knob|capsules|items|<item>]
"""

import json
import math
import os
import random
import shutil
import subprocess
import sys
import tempfile

import bmesh
import bpy
from bpy_extras.object_utils import world_to_camera_view
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath('assets/weekly-gacha/art')
FRAMES = int(os.environ.get('SPIN_FRAMES', 24))
SAMPLES = int(os.environ.get('SAMPLES', 96))
COLS = 6
CELL = 384
TOOLS = ['/opt/homebrew/bin', '/usr/local/bin']

# The machine's frame, in scene units: centred on (0, MID), VIEW tall
MID = 1.86
VIEW = 3.95
WIDE = 900
TALL = round(WIDE * VIEW / 2.53)
KNOB = (0.0, 1.06)
KNOB_VIEW = 0.8
CHUTE = (0.0, 0.42)
# Looking down on it a little, for the top of the body and the depth of the dome
TILT = 0.13

CAPSULES = {
    'blue': '#3253FF',
    'orange': '#FF7A1F',
    'navy': '#1B2A9C',
    'pearl': '#F7F3EA',
    'gold': '#FFC21A',
}


def tool(name):
    for d in TOOLS:
        if os.path.exists(os.path.join(d, name)):
            return os.path.join(d, name)
    return shutil.which(name) or name


def lin(hex_):
    """An sRGB hex colour, linear, as Blender wants it"""
    h = hex_.lstrip('#')
    out = []
    for i in (0, 2, 4):
        c = int(h[i:i + 2], 16) / 255
        out.append(c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4)
    return (*out, 1.0)


def reset(width, height):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception:
        pass
    scene.cycles.samples = SAMPLES
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    # Glass shows what's behind it, the app's world, rather than black
    scene.cycles.film_transparent_glass = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    lights = os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources')
    for v in sorted(os.listdir(lights)):
        path = os.path.join(lights, v, 'datafiles', 'studiolights', 'world', 'studio.exr')
        if os.path.exists(path):
            env.image = bpy.data.images.load(path)
    bg = nt.nodes['Background']
    bg.inputs['Strength'].default_value = 0.6
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    # A warm key high on the left, a cool rim behind on the right, a big soft box over the camera
    for name, loc, energy, colour, size in (
        ('key', (-4, -4, 5), 650, (1.0, 0.93, 0.82), 3),
        ('rim', (5, 3, 3), 900, (0.8, 0.88, 1.0), 2),
        ('box', (2, -6, 3), 380, (1.0, 0.97, 0.92), 6),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.color = colour
        data.size = size
        o = bpy.data.objects.new(name, data)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 1.5)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(o)
    return scene


def ortho(scene, centre, height, tilt=0.0):
    """A camera looking along +y at `centre` (x, z), `height` units tall in frame, tipped down `tilt` radians"""
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.sensor_fit = 'VERTICAL'
    cam.ortho_scale = height
    o = bpy.data.objects.new('cam', cam)
    d = 20
    o.location = (centre[0], -d * math.cos(tilt), centre[1] + d * math.sin(tilt))
    o.rotation_euler = (math.pi / 2 - tilt, 0, 0)
    scene.collection.objects.link(o)
    scene.camera = o
    return o


def perspective(scene):
    """Looking along +y at the origin from far off on a long lens, framing 2 units square"""
    cam = bpy.data.cameras.new('cam')
    cam.lens = 85
    cam.sensor_fit = 'HORIZONTAL'
    cam.sensor_width = 36
    o = bpy.data.objects.new('cam', cam)
    o.location = (0, -2 * cam.lens / cam.sensor_width, 0)
    o.rotation_euler = (math.pi / 2, 0, 0)
    scene.collection.objects.link(o)
    scene.camera = o
    return o


# ---- Materials ----


def mat(name, colour, metallic=0.0, rough=0.3, coat=0.0, emit=0.0, emit_colour=None, transmission=0.0, ior=1.45, spec=0.5):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(colour)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.05
    b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['IOR'].default_value = ior
    b.inputs['Specular IOR Level'].default_value = spec
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit_colour or colour)
        b.inputs['Emission Strength'].default_value = emit
    return m


def gold():
    return mat('gold', '#FFD36B', metallic=1.0, rough=0.24)


def paint(colour, rough=0.22):
    return mat('paint', colour, rough=rough, coat=0.8)


def glass(tint='#FFFFFF'):
    return mat('glass', tint, rough=0.02, transmission=1.0, ior=1.3)


def thin(obj, thickness=0.025):
    """Hollow it out to a thin wall, glass you can see things inside of"""
    shell = obj.modifiers.new('shell', 'SOLIDIFY')
    shell.thickness = thickness
    return obj


# ---- Building blocks ----


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def apply(obj, material, bevel=0.0, segments=5, smooth=True):
    bpy.context.view_layer.objects.active = obj
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    if smooth:
        for p in obj.data.polygons:
            p.use_smooth = True
    obj.data.materials.append(material)
    return obj


def box(size, loc, material, bevel=0.0):
    bpy.ops.mesh.primitive_cube_add(size=1, location=loc)
    o = bpy.context.active_object
    o.scale = size
    return apply(o, material, bevel)


def cylinder(radius, depth, loc, material, rot=(0, 0, 0), bevel=0.0, verts=96):
    bpy.ops.mesh.primitive_cylinder_add(vertices=verts, radius=radius, depth=depth, location=loc, rotation=rot)
    o = bpy.context.active_object
    return apply(o, material, bevel)


def sphere(radius, loc, material, segments=64):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2, radius=radius, location=loc)
    return apply(bpy.context.active_object, material)


def lathe(profile, material, steps=96, name='lathe'):
    """A solid of revolution about z, from (r, z) points"""
    bm = bmesh.new()
    verts = [bm.verts.new((r, 0, z)) for r, z in profile]
    edges = [bm.edges.new((a, b)) for a, b in zip(verts, verts[1:])]
    bmesh.ops.spin(bm, geom=verts + edges, cent=(0, 0, 0), axis=(0, 0, 1), angle=2 * math.pi, steps=steps, use_merge=True)
    bmesh.ops.remove_doubles(bm, verts=bm.verts, dist=1e-5)
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    o = link(bpy.data.objects.new(name, mesh))
    for p in mesh.polygons:
        p.use_smooth = True
    mesh.materials.append(material)
    return o


def capsule(radius, top, bottom, loc=(0, 0, 0), rot=(0, 0, 0), half=None, inner_glow=None):
    """A capsule: two hemispheres and a seam. `half` keeps only 'top' or 'bottom'"""
    parts = []
    for side in ('top', 'bottom'):
        if half and side != half:
            continue
        bm = bmesh.new()
        bmesh.ops.create_uvsphere(bm, u_segments=64, v_segments=32, radius=radius)
        cut = [v for v in bm.verts if (v.co.z < -1e-6 if side == 'top' else v.co.z > 1e-6)]
        bmesh.ops.delete(bm, geom=cut, context='VERTS')
        mesh = bpy.data.meshes.new(side)
        bm.to_mesh(mesh)
        bm.free()
        o = link(bpy.data.objects.new(side, mesh))
        for p in mesh.polygons:
            p.use_smooth = True
        mesh.materials.append(top if side == 'top' else bottom)
        # A shell, so it's solid where it's opened
        shell = o.modifiers.new('shell', 'SOLIDIFY')
        shell.thickness = radius * 0.06
        if inner_glow is not None:
            mesh.materials.append(inner_glow)
            shell.material_offset = 1
        parts.append(o)
    seam = mat('seam', '#2A2A3A', rough=0.4)
    bpy.ops.mesh.primitive_torus_add(major_radius=radius * 1.005, minor_radius=radius * 0.035, major_segments=64, minor_segments=12)
    ring = bpy.context.active_object
    ring.data.materials.append(seam)
    for p in ring.data.polygons:
        p.use_smooth = True
    parts.append(ring)
    holder = link(bpy.data.objects.new('capsule', None))
    holder.location = loc
    holder.rotation_euler = rot
    for p in parts:
        p.parent = holder
    return holder


# ---- The machine ----


def machine():
    scene = reset(WIDE, TALL)
    cam = ortho(scene, (0, MID), VIEW, tilt=TILT)
    body = paint('#EE6A0C')
    trim = gold()
    dark = mat('dark', '#120802', rough=1.0, spec=0.0)
    pearl = paint('#FFF6E4', rough=0.25)
    cream = paint('#E8BC78', rough=0.3)
    # The body, on a plinth, a gold band round its shoulder
    box((2.0, 1.6, 1.42), (0, 0, 0.87), body, bevel=0.2)
    box((2.16, 1.76, 0.2), (0, 0, 0.1), trim, bevel=0.06)
    box((2.1, 1.7, 0.1), (0, 0, 1.56), trim, bevel=0.04)
    # The collar the dome sits in, and the dome on it, heaped with capsules, a gold cap on top
    cylinder(0.98, 0.2, (0, 0, 1.7), trim, bevel=0.05)
    cylinder(0.9, 0.06, (0, 0, 1.79), dark)
    lathe([(0.0, 1.78), (0.92, 1.78), (0.94, 1.8)], dark, name='floor')
    thin(sphere(1.0, (0, 0, 2.62), glass()))
    cylinder(0.26, 0.14, (0, 0, 3.6), trim, bevel=0.04)
    sphere(0.14, (0, 0, 3.74), trim)
    # A cream panel on the front, edged in gold, with the knob and the chute on it
    box((1.36, 0.08, 1.32), (0, -0.79, 0.78), trim, bevel=0.14)
    box((1.28, 0.08, 1.24), (0, -0.81, 0.78), cream, bevel=0.12)
    # The knob's plate: a gold ring round pearl
    cylinder(0.38, 0.06, (KNOB[0], -0.86, KNOB[1]), trim, rot=(math.pi / 2, 0, 0), bevel=0.02)
    cylinder(0.33, 0.07, (KNOB[0], -0.87, KNOB[1]), pearl, rot=(math.pi / 2, 0, 0), bevel=0.015)
    # The chute: a dark mouth in a gold frame, a little lip under it
    box((0.78, 0.08, 0.5), (CHUTE[0], -0.86, CHUTE[1]), trim, bevel=0.07)
    box((0.62, 0.08, 0.36), (CHUTE[0], -0.9, CHUTE[1] + 0.02), dark, bevel=0.06)
    box((0.7, 0.2, 0.06), (CHUTE[0], -0.96, CHUTE[1] - 0.2), trim, bevel=0.025)
    heap()
    out = os.path.join(OUT, 'machine.png')
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('wrote', out)
    # Where the knob and the chute are on it, as fractions of it, and how big the knob's picture is
    def at(x, y, z):
        p = world_to_camera_view(scene, cam, Vector((x, y, z)))
        return {'x': p.x, 'y': 1 - p.y}

    layout = {
        'aspect': WIDE / TALL,
        'knob': {**at(KNOB[0], -0.95, KNOB[1]), 'size': KNOB_VIEW / VIEW},
        'chute': at(CHUTE[0], -0.9, CHUTE[1]),
    }
    json.dump(layout, open(os.path.join(OUT, 'layout.json'), 'w'), indent=2)
    print('layout', layout)


def heap():
    """Capsules dropped one by one into the dome, each settling as low as it can"""
    rnd = random.Random(7)
    centre = Vector((0, 0, 2.62))
    inner = 0.93
    r = 0.2
    floor = 1.8
    placed = []
    colours = ['blue', 'orange', 'pearl', 'navy', 'gold', 'blue', 'orange', 'pearl']
    tops = {k: paint(v) for k, v in CAPSULES.items()}
    bottom = paint('#FFFFFF', rough=0.18)
    for i in range(30):
        best = None
        for _ in range(60):
            a = rnd.uniform(0, 2 * math.pi)
            d = math.sqrt(rnd.random()) * (inner - r)
            x, y = d * math.cos(a), d * math.sin(a)
            z = floor + r
            while z < centre.z + 0.55:
                p = Vector((x, y, z))
                if (p - centre).length + r <= inner and all((p - q).length >= 2 * r * 0.97 for q in placed):
                    break
                z += 0.015
            else:
                continue
            if best is None or z < best.z:
                best = Vector((x, y, z))
        if best is None:
            continue
        placed.append(best)
        rot = (rnd.uniform(0, math.pi), rnd.uniform(0, math.pi), rnd.uniform(0, math.pi))
        capsule(r, tops[colours[i % len(colours)]], bottom, best, rot)


def knob():
    scene = reset(320, 320)
    ortho(scene, (0, 0), KNOB_VIEW)
    trim = gold()
    pearl = paint('#FFF6E4', rough=0.25)
    cylinder(0.3, 0.12, (0, -0.06, 0), trim, rot=(math.pi / 2, 0, 0), bevel=0.04)
    # The grip across it, and a pearl dot near the rim to show how far round it's gone
    box((0.5, 0.16, 0.13), (0, -0.16, 0), pearl, bevel=0.06)
    cylinder(0.045, 0.04, (0, -0.135, 0.22), pearl, rot=(math.pi / 2, 0, 0), bevel=0.01)
    sphere(0.06, (0, -0.24, 0), trim)
    out = os.path.join(OUT, 'knob.png')
    scene.render.filepath = out
    bpy.ops.render.render(write_still=True)
    print('wrote', out)


def capsules():
    for name, colour in CAPSULES.items():
        for half in ('top', 'bottom'):
            scene = reset(320, 320)
            ortho(scene, (0, 0), 2.5, tilt=0.32)
            top = mat('top', '#FFD25A', metallic=1.0, rough=0.24) if name == 'gold' else paint(colour)
            bottom = paint('#FFFFFF', rough=0.18)
            glow = mat('glow', '#FFF2C4', emit=6.0, emit_colour='#FFE7A0')
            capsule(1.0, top, bottom, half=half, inner_glow=glow if half == 'bottom' else None)
            out = os.path.join(OUT, f'capsule-{name}-{half}.png')
            scene.render.filepath = out
            bpy.ops.render.render(write_still=True)
            print('wrote', out)


# ---- The prizes ----


def outline_solid(points, sharp, depth, bevel, material, name):
    """A puffy flat shape standing up, from (x, z) points round its edge; `sharp` are its corners"""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = depth
    curve.bevel_depth = bevel
    curve.bevel_resolution = 6
    curve.resolution_u = 24
    s = curve.splines.new('BEZIER')
    s.bezier_points.add(len(points) - 1)
    for i, (bp, (x, z)) in enumerate(zip(s.bezier_points, points)):
        bp.co = (x, z, 0)
        t = 'VECTOR' if i in sharp else 'AUTO'
        bp.handle_left_type = t
        bp.handle_right_type = t
    s.use_cyclic_u = True
    o = link(bpy.data.objects.new(name, curve))
    o.rotation_euler = (math.pi / 2, 0, 0)
    bpy.context.view_layer.objects.active = o
    for x in bpy.context.selected_objects:
        x.select_set(False)
    o.select_set(True)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.view_layer.objects.active
    for p in o.data.polygons:
        p.use_smooth = True
    o.data.materials.append(material)
    return o


def bolt():
    pts = [(0.18, 1.0), (-0.5, -0.08), (-0.02, -0.08), (-0.26, -1.0), (0.52, 0.16), (0.06, 0.16), (0.38, 1.0)]
    outline_solid(pts, set(range(len(pts))), 0.14, 0.09, mat('bolt', '#FFB300', rough=0.2, coat=1.0, emit=0.15), 'bolt')


def flame():
    outer = [(0.0, -0.95), (0.6, -0.72), (0.8, -0.18), (0.6, 0.32), (0.3, 0.62), (-0.04, 1.02), (-0.16, 0.55),
             (-0.44, 0.7), (-0.66, 0.2), (-0.76, -0.3), (-0.56, -0.76)]
    outline_solid(outer, {5, 7}, 0.16, 0.13, mat('flame', '#FF6A1A', rough=0.25, coat=1.0, emit=0.5), 'flame')
    inner = [(0.0, -0.78), (0.36, -0.6), (0.46, -0.22), (0.3, 0.14), (0.04, 0.42), (-0.12, 0.1), (-0.36, -0.22), (-0.34, -0.6)]
    inner = [(x, z) for x, z in inner]
    o = outline_solid(inner, {4}, 0.3, 0.1, mat('core', '#FFD43F', rough=0.25, coat=1.0, emit=1.0), 'core')
    o.location = (0, 0.0, -0.02)


def books():
    covers = ['#2438C2', '#FF7A1F', '#FFC21A']
    pages = mat('pages', '#FFF6E2', rough=0.6)
    for i, colour in enumerate(covers):
        z = -0.45 + i * 0.36
        holder = link(bpy.data.objects.new('book', None))
        cover = box((1.5, 1.05, 0.3), (0, 0, 0), paint(colour), bevel=0.05)
        block = box((1.42, 0.98, 0.22), (0.05, 0, 0), pages, bevel=0.01)
        band = box((0.12, 1.07, 0.32), (-0.55, 0, 0), gold(), bevel=0.02)
        for o in (cover, block, band):
            o.parent = holder
        holder.location = (0.06 * (i - 1), 0, z)
        holder.rotation_euler = (0, 0, [0.12, -0.16, 0.2][i])


def hourglass():
    trim = gold()
    profile = []
    for i in range(41):
        z = -0.72 + i * 1.44 / 40
        k = abs(z) / 0.72
        r = 0.07 + 0.5 * math.sin(min(1, k * 1.15) * math.pi * 0.62) ** 1.3
        if k > 0.86:
            r *= 1 - (k - 0.86) * 2.2
        profile.append((r, z))
    thin(lathe([(0.0, -0.74)] + profile + [(0.0, 0.74)], glass('#F2F6FF'), name='glass'))
    sand = mat('sand', '#FFB21A', rough=0.5, emit=0.3)
    lathe([(0.0, -0.66), (0.44, -0.62), (0.34, -0.36), (0.06, -0.12), (0.0, -0.1)], sand, name='sand-low')
    lathe([(0.0, 0.14), (0.16, 0.24), (0.26, 0.4), (0.0, 0.42)], sand, name='sand-high')
    cylinder(0.025, 0.5, (0, 0, -0.35), sand, verts=16)
    for z in (-0.82, 0.82):
        cylinder(0.64, 0.14, (0, 0, z), trim, bevel=0.04)
    for k in range(3):
        a = k * 2 * math.pi / 3 + 0.5
        cylinder(0.04, 1.6, (0.56 * math.cos(a), 0.56 * math.sin(a), 0), trim, verts=24)


def trophy():
    trim = gold()
    profile = [(0.0, -0.98), (0.52, -0.98), (0.52, -0.8), (0.4, -0.78), (0.36, -0.72), (0.14, -0.66), (0.09, -0.4),
               (0.09, -0.2), (0.16, -0.12), (0.3, -0.06), (0.5, 0.12), (0.64, 0.42), (0.7, 0.8), (0.74, 0.84),
               (0.66, 0.84), (0.6, 0.48), (0.0, 0.46)]
    lathe(profile, trim, name='cup')
    for side in (-1, 1):
        bpy.ops.mesh.primitive_torus_add(major_radius=0.26, minor_radius=0.055, major_segments=48, minor_segments=16,
                                         location=(side * 0.66, 0, 0.42), rotation=(math.pi / 2, 0, 0))
        o = bpy.context.active_object
        for p in o.data.polygons:
            p.use_smooth = True
        o.data.materials.append(trim)
    box((1.3, 1.3, 0.24), (0, 0, -1.08), mat('plinth', '#3A1E0A', rough=0.35, coat=0.8), bevel=0.05)
    star = [(math.cos(math.pi / 2 + k * math.pi / 5) * (0.2 if k % 2 == 0 else 0.085),
             math.sin(math.pi / 2 + k * math.pi / 5) * (0.2 if k % 2 == 0 else 0.085)) for k in range(10)]
    o = outline_solid(star, set(range(10)), 0.03, 0.02, mat('star', '#2438C2', rough=0.2, coat=1.0), 'star')
    o.location = (0, -0.62, 0.42)
    o.rotation_euler = (math.pi / 2 - 0.12, 0, 0)


ITEMS = {'bolt': bolt, 'flame': flame, 'books': books, 'hourglass': hourglass, 'trophy': trophy}


def fit(objs, span=1.72):
    """Everything in the scene grouped, centred and scaled so its biggest side is `span`"""
    holder = link(bpy.data.objects.new('item', None))
    for o in objs:
        if o.parent is None:
            o.parent = holder
    bpy.context.view_layer.update()
    lo = Vector((1e9, 1e9, 1e9))
    hi = Vector((-1e9, -1e9, -1e9))
    for o in objs:
        if o.type != 'MESH':
            continue
        for c in o.bound_box:
            w = o.matrix_world @ Vector(c)
            lo = Vector(map(min, lo, w))
            hi = Vector(map(max, hi, w))
    size = max(hi.x - lo.x, hi.z - lo.z, hi.y - lo.y)
    k = span / size
    mid = (lo + hi) / 2
    pivot = link(bpy.data.objects.new('pivot', None))
    holder.parent = pivot
    holder.location = -mid
    pivot.scale = (k, k, k)
    return pivot


def item(name):
    scene = reset(CELL, CELL)
    perspective(scene)
    ITEMS[name]()
    objs = [o for o in scene.objects if o.type in ('MESH', 'EMPTY')]
    pivot = fit(objs)
    work = tempfile.mkdtemp()
    frames = []
    for i in range(FRAMES):
        pivot.rotation_euler = (0, 0, 2 * math.pi * i / FRAMES)
        path = os.path.join(work, f'f{i:03d}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        frames.append(path)
    out = os.path.join(OUT, f'item-{name}.png')
    subprocess.run(
        [tool('magick'), 'montage', *frames, '-background', 'none', '-tile', f'{COLS}x', '-geometry', f'{CELL}x{CELL}+0+0', out],
        check=True,
    )
    print('wrote', out)


if __name__ == '__main__':
    os.makedirs(OUT, exist_ok=True)
    parts = ARGS or ['machine', 'knob', 'capsules', 'items']
    for part in parts:
        if part == 'machine':
            machine()
        elif part == 'knob':
            knob()
        elif part == 'capsules':
            capsules()
        elif part == 'items':
            for name in ITEMS:
                item(name)
        elif part in ITEMS:
            item(part)
