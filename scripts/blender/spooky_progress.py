"""
Spooky Progress's solid things (src/demos/spooky-progress), rendered with Cycles on transparent so the
app can lay them over its own night.

- pumpkin-plain.png        a pumpkin, uncarved, in the moonlight
- pumpkin-<k>.png          carved with face k (0 to 4), a candle burning inside it
- pumpkin-<k>-green.png    the same, the candle burning ghostly green
- web.png                  a cobweb in a corner, its top left, beaded with dew and lit from behind
- spider.png               a spider, from in front and above, its legs going: an atlas of FRAMES
                           frames, COLS across, CELL px square
- bomb.png                 a black pumpkin bomb, carved and lit, a metal cap on top
- bone.png                 a bone lying across, a groove down its front for slime to run along
- layout.json              where the bone's groove runs on bone.png, as fractions

Run headless (all of it, or just some parts):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/spooky_progress.py -- [pumpkins|web|spider|bomb|bone]
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
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
OUT = os.path.abspath('assets/spooky-progress/art')
SAMPLES = int(os.environ.get('SAMPLES', 96))
FRAMES = int(os.environ.get('SPIDER_FRAMES', 8))
COLS = 4
CELL = 256
TOOLS = ['/opt/homebrew/bin', '/usr/local/bin']


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


def reset(width, height, world=0.25):
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
    scene.cycles.film_transparent_glass = True
    scene.render.resolution_x = width
    scene.render.resolution_y = height
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    scene.view_settings.view_transform = 'AgX'
    scene.view_settings.look = 'AgX - Medium High Contrast'
    w = bpy.data.worlds.new('world')
    scene.world = w
    w.use_nodes = True
    bg = w.node_tree.nodes['Background']
    # A moonlit night: a dim blue-violet sky all round
    bg.inputs['Color'].default_value = (0.18, 0.17, 0.32, 1)
    bg.inputs['Strength'].default_value = world
    return scene


def light(scene, name, kind, loc, energy, colour, size=1.0, target=(0, 0, 0)):
    data = bpy.data.lights.new(name, kind)
    data.energy = energy
    data.color = colour
    if kind == 'AREA':
        data.size = size
    elif kind in ('POINT', 'SPOT'):
        data.shadow_soft_size = size
    o = bpy.data.objects.new(name, data)
    o.location = loc
    o.rotation_euler = (Vector(target) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(o)
    return o


def moonlight(scene, key=380, rim=900):
    """A cool moon high on the left, a warm-violet rim behind on the right, a little fill in front"""
    light(scene, 'moon', 'AREA', (-4, -4, 5), key, (0.78, 0.84, 1.0), 3)
    light(scene, 'rim', 'AREA', (4, 3.5, 2.5), rim, (1.0, 0.72, 0.95), 2.5)
    light(scene, 'fill', 'AREA', (1.5, -6, 0.5), key * 0.35, (0.9, 0.85, 1.0), 6)


def ortho(scene, centre, height, tilt=0.0, aim_y=0.0):
    """A camera looking along +y at `centre` (x, z), `height` units tall in frame, tipped down `tilt` radians"""
    cam = bpy.data.cameras.new('cam')
    cam.type = 'ORTHO'
    cam.sensor_fit = 'VERTICAL'
    cam.ortho_scale = height
    o = bpy.data.objects.new('cam', cam)
    d = 20
    o.location = (centre[0], aim_y - d * math.cos(tilt), centre[1] + d * math.sin(tilt))
    o.rotation_euler = (math.pi / 2 - tilt, 0, 0)
    scene.collection.objects.link(o)
    scene.camera = o
    return o


# ---- Materials ----


def mat(name, colour, metallic=0.0, rough=0.4, coat=0.0, emit=0.0, emit_colour=None, transmission=0.0, ior=1.45,
        subsurface=0.0, sheen=0.0, sheen_tint=None):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = lin(colour)
    b.inputs['Metallic'].default_value = metallic
    b.inputs['Roughness'].default_value = rough
    b.inputs['Coat Weight'].default_value = coat
    b.inputs['Coat Roughness'].default_value = 0.08
    b.inputs['Transmission Weight'].default_value = transmission
    b.inputs['IOR'].default_value = ior
    if subsurface:
        b.inputs['Subsurface Weight'].default_value = subsurface
        b.inputs['Subsurface Radius'].default_value = (1.0, 0.45, 0.2)
        b.inputs['Subsurface Scale'].default_value = 0.08
    if sheen:
        b.inputs['Sheen Weight'].default_value = sheen
        b.inputs['Sheen Tint'].default_value = lin(sheen_tint or '#FFFFFF')
    if emit:
        b.inputs['Emission Color'].default_value = lin(emit_colour or colour)
        b.inputs['Emission Strength'].default_value = emit
    return m


def bumpy(m, scale=18.0, strength=0.25, detail=6.0):
    """Give a material a noisy bumped surface"""
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    noise.inputs['Detail'].default_value = detail
    bump = nt.nodes.new('ShaderNodeBump')
    bump.inputs['Strength'].default_value = strength
    nt.links.new(noise.outputs['Fac'], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], b.inputs['Normal'])
    return m


def mottled(m, a, b_, scale=6.0):
    """Mix two colours through the base colour by noise"""
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    noise = nt.nodes.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = scale
    ramp = nt.nodes.new('ShaderNodeValToRGB')
    ramp.color_ramp.elements[0].color = lin(a)
    ramp.color_ramp.elements[1].color = lin(b_)
    ramp.color_ramp.elements[0].position = 0.35
    ramp.color_ramp.elements[1].position = 0.7
    nt.links.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    nt.links.new(ramp.outputs['Color'], b.inputs['Base Color'])
    return m


# ---- Building blocks ----


def link(obj):
    bpy.context.scene.collection.objects.link(obj)
    return obj


def select_only(obj):
    for o in bpy.context.selected_objects:
        o.select_set(False)
    obj.select_set(True)
    bpy.context.view_layer.objects.active = obj


def apply_mods(obj):
    select_only(obj)
    for m in list(obj.modifiers):
        bpy.ops.object.modifier_apply(modifier=m.name)


def smooth(obj):
    for p in obj.data.polygons:
        p.use_smooth = True
    return obj


def sphere(radius, loc, material, segments=48, scale=(1, 1, 1)):
    bpy.ops.mesh.primitive_uv_sphere_add(segments=segments, ring_count=segments // 2, radius=radius, location=loc)
    o = bpy.context.active_object
    o.scale = scale
    select_only(o)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    smooth(o)
    o.data.materials.append(material)
    return o


def tube(points, radii, material, bevel=1.0, name='tube'):
    """A smooth tapering tube through `points`, `radii` thick at each"""
    curve = bpy.data.curves.new(name, 'CURVE')
    curve.dimensions = '3D'
    curve.bevel_depth = bevel
    curve.bevel_resolution = 6
    curve.use_fill_caps = True
    s = curve.splines.new('POLY' if len(points) <= 2 else 'BEZIER')
    if s.type == 'BEZIER':
        s.bezier_points.add(len(points) - 1)
        for bp, p, r in zip(s.bezier_points, points, radii):
            bp.co = p
            bp.handle_left_type = 'AUTO'
            bp.handle_right_type = 'AUTO'
            bp.radius = r
    else:
        s.points.add(len(points) - 1)
        for pt, p, r in zip(s.points, points, radii):
            pt.co = (*p, 1)
            pt.radius = r
    o = link(bpy.data.objects.new(name, curve))
    curve.materials.append(material)
    return o


def prism(poly, y0, y1, name='cutter'):
    """A solid with `poly`'s outline ((x, z) points, anticlockwise) running from y0 to y1"""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y0, z)) for x, z in poly]
    face = bm.faces.new(vs)
    ext = bmesh.ops.extrude_face_region(bm, geom=[face])
    moved = [e for e in ext['geom'] if isinstance(e, bmesh.types.BMVert)]
    bmesh.ops.translate(bm, verts=moved, vec=(0, y1 - y0, 0))
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    return link(bpy.data.objects.new(name, mesh))


def cut(target, cutters):
    for c in cutters:
        mod = target.modifiers.new('cut', 'BOOLEAN')
        mod.operation = 'DIFFERENCE'
        mod.solver = 'EXACT'
        mod.object = c
        c.hide_render = True
        c.hide_viewport = True
    apply_mods(target)
    for c in cutters:
        bpy.data.objects.remove(c)


def render(path):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    bpy.context.scene.render.filepath = path
    bpy.ops.render.render(write_still=True)
    print('wrote', path)


# ---- Faces, as outlines on the front of a pumpkin about 1 across its half ----


def tri(cx, cz, w, h, tilt=0.0):
    return [(cx - w / 2, cz - h / 2 - tilt), (cx + w / 2, cz - h / 2 + tilt), (cx, cz + h / 2)]


def circle(cx, cz, r, n=20):
    return [(cx + math.cos(i / n * 2 * math.pi) * r, cz + math.sin(i / n * 2 * math.pi) * r) for i in range(n)]


def arc_mouth(w, top, bottom, n=16, teeth=0, tooth=0.0, sides=0.0):
    """A grin: its top edge across at `top` (zigzag if it has teeth), its bottom a curve down to `bottom`"""
    pts = []
    for i in range(n + 1):
        x = -w + 2 * w * i / n
        pts.append((x, bottom + (top - bottom) * (x / w) ** 2 + sides * (x / w)))
    upper = []
    steps = teeth * 2 if teeth else n
    for i in range(steps + 1):
        x = w - 2 * w * i / steps
        dip = tooth if teeth and i % 2 else 0.0
        upper.append((x * 0.98, top - dip - 0.1 * (1 - (x / w) ** 2) + sides * (x / w)))
    return pts + upper[1:-1]


def faces():
    e = 0.16
    x = 0.36
    return [
        [tri(-x, e, 0.32, 0.3), tri(x, e, 0.32, 0.3), arc_mouth(0.52, -0.12, -0.5)],
        [circle(-x, e, 0.14), circle(x, e, 0.14), arc_mouth(0.5, -0.14, -0.48, teeth=3, tooth=0.11)],
        [tri(-x, e, 0.36, 0.26, 0.07), tri(x, e, 0.36, 0.26, -0.07), arc_mouth(0.48, -0.16, -0.52, teeth=2, tooth=-0.13)],
        [tri(-x, e, 0.3, 0.32), [(x - 0.16, e - 0.02), (x + 0.16, e - 0.02), (x + 0.1, e + 0.06), (x - 0.1, e + 0.06)],
         arc_mouth(0.46, -0.1, -0.46, sides=0.08)],
        [tri(-x, e + 0.02, 0.3, 0.36), tri(x, e + 0.02, 0.3, 0.36), tri(0, -0.04, 0.12, 0.12),
         arc_mouth(0.58, -0.16, -0.62, teeth=4, tooth=0.1)],
    ]


# ---- Pumpkins ----


def ribbed(radius=1.0, squash=0.8, ribs=8, depth=0.08, name='body', dimple=True):
    """A sphere pressed into ribs round its middle, flattened, dimpled in at top and bottom"""
    bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=radius)
    o = bpy.context.active_object
    o.name = name
    for v in o.data.vertices:
        p = v.co
        phi = math.atan2(p.y, p.x)
        rib = 1 - depth * (1 - abs(math.cos(ribs / 2 * phi))) ** 1.4
        z = p.z / radius
        # Dimpled in at the poles
        pole = 1 - 0.18 * max(0.0, abs(z) - 0.7) / 0.3
        v.co.x = p.x * rib
        v.co.y = p.y * rib
        v.co.z = p.z * squash * (pole if dimple else 1) - (0.12 * radius if dimple and z > 0.92 else 0)
    smooth(o)
    sub = o.modifiers.new('sub', 'SUBSURF')
    sub.levels = 1
    sub.render_levels = 1
    return o


def candle(scene, colour, energy=60):
    """A candle's light, inside, low, flickering warm (or green)"""
    light(scene, 'candle', 'POINT', (0, 0.05, -0.25), energy, colour, 0.15)
    light(scene, 'candle2', 'POINT', (0, -0.1, -0.05), energy * 0.6, colour, 0.25)


def pumpkin(face_k=None, flame=None):
    scene = reset(CELL + 64, CELL + 64)
    moonlight(scene, key=300 if flame else 420, rim=700)
    skin = mat('skin', '#F2780F', rough=0.42, coat=0.3, subsurface=0.05)
    mottled(skin, '#E2680C', '#F98A22', 3)
    bumpy(skin, 30, 0.05)
    body = ribbed(depth=0.15)
    body.data.materials.append(skin)
    shell = body.modifiers.new('shell', 'SOLIDIFY')
    shell.thickness = 0.09
    shell.offset = -1
    apply_mods(body)
    if face_k is not None:
        cutters = [prism(p, -1.6, -0.5) for p in faces()[face_k]]
        cut(body, cutters)
        inside = mat('flesh', '#FFC064', rough=0.6, emit=1.6, emit_colour='#FFA43A' if flame == '#FFB347' else '#8CFF4A')
        body.data.materials.append(inside)
        # The cut edges and the inside wall in flesh: anything not facing out
        for p in body.data.polygons:
            d = p.normal.dot(p.center.normalized())
            if d < -0.2 or (d < 0.5 and p.center.y < -0.45):
                p.material_index = 1
        candle(scene, (1.0, 0.62, 0.22) if flame == '#FFB347' else (0.5, 1.0, 0.3), 26)
    # The stem: a twisted, tapering stalk, leaning
    stalk = mat('stalk', '#5A6B2A', rough=0.7)
    mottled(stalk, '#3F4E1C', '#7A7F3A', 9)
    bumpy(stalk, 40, 0.4)
    tube([(0, 0, 0.62), (0.03, 0, 0.82), (0.12, 0.02, 0.98), (0.22, 0.04, 1.02)], [1.0, 0.85, 0.7, 0.55], stalk, 0.1, 'stem')
    ortho(scene, (0, 0.12), 2.5, tilt=0.18)
    name = 'pumpkin-plain' if face_k is None else f'pumpkin-{face_k}' + ('-green' if flame != '#FFB347' else '')
    render(os.path.join(OUT, f'{name}.png'))


def pumpkins():
    pumpkin()
    for k in range(5):
        pumpkin(k, '#FFB347')
        pumpkin(k, '#7CF03A')


# ---- The cobweb ----


def web():
    scene = reset(1536, 1536, world=0.08)
    light(scene, 'back', 'AREA', (1.2, 3.0, -0.6), 900, (0.85, 0.9, 1.0), 2.5, target=(0.5, 0, -0.5))
    light(scene, 'side', 'AREA', (-1.5, -1.0, 1.0), 260, (1.0, 0.75, 0.95), 2, target=(0.5, 0, -0.5))
    light(scene, 'front', 'AREA', (0.6, -3.0, -0.4), 70, (0.9, 0.9, 1.0), 3, target=(0.5, 0, -0.5))
    silk = mat('silk', '#DCE3F2', rough=0.12, coat=0.6, emit=0.14, emit_colour='#C9D4F0')
    dew = mat('dew', '#F4F8FF', rough=0.02, coat=1.0, transmission=0.6, ior=1.33, emit=0.55, emit_colour='#E8F0FF')
    rnd = random.Random(7)
    spokes = 8
    angle = [(i / (spokes - 1)) * (math.pi / 2) + math.radians(rnd.uniform(-4, 4)) * (0 < i < spokes - 1)
             for i in range(spokes)]
    end = [Vector((math.cos(a), 0, -math.sin(a))) * (1.02 + 0.12 * rnd.random()) for a in angle]
    for e in end:
        mid = e * 0.5 + Vector((rnd.uniform(-0.02, 0.02), 0, rnd.uniform(-0.02, 0.02)))
        tube([(0, 0, 0), tuple(mid), tuple(e)], [1, 1, 1], silk, 0.0016, 'spoke')
    drops = []
    rings = 12
    for ring in range(1, rings + 1):
        base = (ring / rings) ** 0.9 * 0.97
        at = [base * (0.97 + 0.06 * rnd.random()) for _ in range(spokes)]
        for i in range(spokes - 1):
            if rnd.random() < 0.08:
                continue
            ra = at[i]
            rb = at[i + 1]
            a = end[i].normalized() * ra
            b = end[i + 1].normalized() * rb
            pts = []
            n = 16
            droop = 0.1 + 0.06 * rnd.random()
            for j in range(n + 1):
                k = j / n
                p = a.lerp(b, k)
                sag = droop * (a - b).length * 4 * k * (1 - k)
                p = p - (a + b).normalized() * sag
                pts.append(p)
            curve = bpy.data.curves.new('ring', 'CURVE')
            curve.dimensions = '3D'
            curve.bevel_depth = 0.0011
            curve.bevel_resolution = 3
            s = curve.splines.new('POLY')
            s.points.add(len(pts) - 1)
            for pt, p in zip(s.points, pts):
                pt.co = (p.x, p.y, p.z, 1)
            link(bpy.data.objects.new('ring', curve)).data.materials.append(silk)
            for j in range(2, n - 1, 2):
                if rnd.random() < 0.16:
                    drops.append((pts[j], 0.004 + 0.009 * rnd.random() ** 2))
    # A strand broken off one ring, hanging down with a drop on its end
    hang = end[3].normalized() * 0.62
    tip = hang + Vector((0.03, 0, -0.3))
    tube([tuple(hang), tuple(hang.lerp(tip, 0.5) + Vector((0.02, 0, 0))), tuple(tip)], [1, 1, 1], silk, 0.0012, 'loose')
    drops.append((tip, 0.014))
    for p, r in drops:
        sphere(r, p + Vector((0, -0.002, -r * 0.7)), dew, 20, (1, 1, 1.15))
    ortho(scene, (0.52, -0.52), 1.12)
    # Threads this fine come out wobbly through the denoiser: render big and clean, and shrink it
    scene.cycles.use_denoising = False
    scene.cycles.samples = max(SAMPLES, 160)
    big = os.path.join(tempfile.gettempdir(), 'web-big.png')
    render(big)
    out = os.path.join(OUT, 'web.png')
    subprocess.run([tool('magick'), big, '-resize', '50%', out], check=True)
    print('wrote', out)


# ---- The spider ----


def spider_frame(f):
    scene = reset(CELL, CELL, world=0.3)
    moonlight(scene, key=520, rim=1200)
    velvet = mat('velvet', '#140A1C', rough=0.5, sheen=0.45, sheen_tint='#8E5BD6', coat=0.3)
    bumpy(velvet, 60, 0.35)
    shell = mat('shell', '#140B1C', rough=0.25, coat=0.9)
    eye = mat('eye', '#C8120A', rough=0.05, coat=1.0, emit=0.7, emit_colour='#FF2010')
    mark = mat('mark', '#FF6A1A', rough=0.3, emit=0.8, emit_colour='#FF7A1A')
    sphere(0.5, (0, 0.5, 0.12), velvet, 48, (1.0, 1.25, 0.85))
    sphere(0.3, (0, -0.12, 0.05), shell, 40, (1.0, 1.15, 0.75))
    # An orange hourglass on its back
    for dz, s in ((0.07, 1), (-0.07, -1)):
        bpy.ops.mesh.primitive_cone_add(vertices=3, radius1=0.11, depth=0.14, location=(0, 0.42, 0.55 + dz))
        c = bpy.context.active_object
        c.rotation_euler = (math.radians(90 + 90 * s), 0, 0)
        c.data.materials.append(mark)
    # Eyes: two big, four small
    for x, z, r in ((-0.09, 0.15, 0.07), (0.09, 0.15, 0.07), (-0.17, 0.2, 0.035), (0.17, 0.2, 0.035),
                    (-0.06, 0.26, 0.03), (0.06, 0.26, 0.03)):
        sphere(r, (x, -0.42, z), eye, 16)
    # Fangs
    for x in (-0.06, 0.06):
        tube([(x, -0.42, -0.02), (x * 1.3, -0.47, -0.14), (x * 0.8, -0.45, -0.22)], [1, 0.7, 0.2], shell, 0.03, 'fang')
    phase = 2 * math.pi * f / FRAMES
    for side in (-1, 1):
        for i, a in enumerate((28, 62, 100, 140)):
            p = phase + i * math.pi / 2 + (math.pi if side > 0 else 0)
            yaw = math.radians(a + 9 * math.sin(p))
            d = Vector((side * math.sin(yaw), -math.cos(yaw), 0))
            root = Vector((side * 0.2, -0.1 + i * 0.07, 0.02))
            knee = root + d * (0.55 + 0.05 * i) + Vector((0, 0, 0.42 + 0.07 * math.cos(p)))
            ankle = knee + d * 0.5 + Vector((0, 0, -0.25))
            tip = ankle + d * 0.28 + Vector((0, 0, -0.38 + 0.05 * math.sin(p)))
            tube([tuple(root), tuple(knee), tuple(ankle), tuple(tip)], [1.0, 0.85, 0.6, 0.25], shell, 0.065, 'leg')
            # Orange bands at the knees
            sphere(0.055, tuple(knee), mark, 12)
    cam = bpy.data.cameras.new('cam')
    cam.lens = 70
    o = bpy.data.objects.new('cam', cam)
    o.location = (0, -5.2, 3.6)
    o.rotation_euler = (Vector((0, 0.15, 0)) - o.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(o)
    scene.camera = o
    path = os.path.join(tempfile.gettempdir(), f'spider-{f:02d}.png')
    render(path)
    return path


def spider():
    frames = [spider_frame(f) for f in range(FRAMES)]
    rows = math.ceil(FRAMES / COLS)
    out = os.path.join(OUT, 'spider.png')
    subprocess.run([tool('magick'), 'montage', *frames, '-tile', f'{COLS}x{rows}', '-geometry', f'{CELL}x{CELL}+0+0',
                    '-background', 'none', out], check=True)
    print('wrote', out)


# ---- The bomb ----


def bomb():
    scene = reset(CELL + 64, CELL + 64)
    moonlight(scene, key=520, rim=1300)
    black = mat('black', '#18101F', rough=0.28, coat=1.0)
    bumpy(black, 14, 0.06)
    body = ribbed(1.0, 0.92, 8, 0.05, 'bomb', dimple=False)
    body.data.materials.append(black)
    shell = body.modifiers.new('shell', 'SOLIDIFY')
    shell.thickness = 0.08
    shell.offset = -1
    apply_mods(body)
    cut(body, [prism(p, -1.6, -0.5) for p in faces()[4]])
    inside = mat('hot', '#FF8A24', rough=0.5, emit=2.4, emit_colour='#FF5A00')
    body.data.materials.append(inside)
    for p in body.data.polygons:
        d = p.normal.dot(p.center.normalized())
        if d < -0.2 or (d < 0.5 and p.center.y < -0.45):
            p.material_index = 1
    candle(scene, (1.0, 0.55, 0.18), 30)
    metal = mat('metal', '#6A6478', metallic=1.0, rough=0.35)
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.26, depth=0.3, location=(-0.36, 0, 0.86))
    cap = bpy.context.active_object
    cap.rotation_euler = (0, math.radians(-28), 0)
    smooth(cap)
    cap.data.materials.append(metal)
    rope = mat('rope', '#8A5A2B', rough=0.8)
    bumpy(rope, 80, 0.6)
    tube([(-0.44, 0, 1.0), (-0.56, 0, 1.18), (-0.78, 0, 1.24)], [1, 1, 0.9], rope, 0.06, 'fuse')
    ortho(scene, (-0.06, 0.12), 2.75, tilt=0.12)
    render(os.path.join(OUT, 'bomb.png'))


# ---- The bone ----


def bone():
    wide = 1280
    tall = 240
    scene = reset(wide, tall)
    moonlight(scene, key=520, rim=900)
    ivory = mat('ivory', '#EFE3C8', rough=0.55, subsurface=0.2)
    mottled(ivory, '#D9C9A3', '#F7EFDC', 7)
    bumpy(ivory, 24, 0.15)
    length = 5.0
    mb = bpy.data.metaballs.new('bone')
    mb.resolution = 0.04
    mb.render_resolution = 0.025
    shaft = mb.elements.new()
    shaft.type = 'CAPSULE'
    shaft.size_x = length / 2 - 0.25
    shaft.radius = 0.36
    for x in (-length / 2, length / 2):
        for z in (-0.3, 0.3):
            e = mb.elements.new()
            e.co = (x, 0, z)
            e.radius = 0.42
    o = link(bpy.data.objects.new('bone', mb))
    select_only(o)
    bpy.ops.object.convert(target='MESH')
    o = bpy.context.active_object
    smooth(o)
    o.data.materials.append(ivory)
    # The groove down its front
    groove_half = length / 2 - 0.2
    bpy.ops.mesh.primitive_cylinder_add(vertices=48, radius=0.22, depth=2 * groove_half, location=(0, -0.38, 0),
                                        rotation=(0, math.pi / 2, 0))
    c = bpy.context.active_object
    cut(o, [c])
    span_x = length + 1.4
    ortho(scene, (0, 0), span_x * tall / wide)
    render(os.path.join(OUT, 'bone.png'))
    with open(os.path.join(OUT, 'layout.json'), 'w') as fp:
        json.dump({'bone': {'groove': [0.5 - groove_half / span_x, 0.5 + groove_half / span_x],
                            'grooveHeight': 0.44 / (span_x * tall / wide)}}, fp, indent=2)


PARTS = {'pumpkins': pumpkins, 'web': web, 'spider': spider, 'bomb': bomb, 'bone': bone}

if __name__ == '__main__':
    for name in ARGS or list(PARTS):
        PARTS[name]()
