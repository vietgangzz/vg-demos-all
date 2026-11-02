"""
Bakes the Corner Shop's light. The app sends each place's fixtures (everything that never moves:
walls, shelves, counter, posters, the desk and what's always on it) as triangles, corner by corner,
with the lights it's lit by (see src/demos/corner-shop/bake.ts and corner_shop_bake_server.py).
Here they're lit for real with Cycles and the light falling on every surface is baked into
lightmaps, one per group of lights, so the app can still bring them up in turn:

  base     the night: moonlight and sky, the lantern by the door (and at home, the window, the
           lamp on the sill)
  room     the string lights inside (at home, the screen on the desk too)
  awning   the bulbs under the awning
  neon     the OPEN in the window

Writes, into assets/corner-shop/bake/:
  <place>.json         each fixture's corner count and every corner's lightmap uv (uint16, base64)
  <place>-<layer>.png  the light, stored as sqrt(light / RANGE)
and src/demos/corner-shop/baked.ts, which requires them.

  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/corner_shop_bake.py -- \
      <place json> [samples] [size]
"""

import base64
import json
import math
import os
import sys

import bpy
import numpy as np
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
SRC = ARGS[0]
SAMPLES = int(ARGS[1]) if len(ARGS) > 1 else 512
SIZE = int(ARGS[2]) if len(ARGS) > 2 else 2048
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
OUT = os.path.join(ROOT, 'assets', 'corner-shop', 'bake')
RANGE = 4.0
os.makedirs(OUT, exist_ok=True)

data = json.load(open(SRC))
PLACE = data['place']
LAYERS = data['layers']
ENV = data['env']

# The door's measurements, as in scene.ts: the doorway is shut while the room is baked
DH, DW = 1.9, 1.3
HX = -DW / 2

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
except Exception as e:  # noqa: BLE001
    print('GPU unavailable, baking on the CPU:', e)
scene.cycles.samples = SAMPLES
scene.cycles.max_bounces = 6
scene.cycles.diffuse_bounces = 4
scene.cycles.use_denoising = False
scene.world = bpy.data.worlds.new('World')
scene.world.use_nodes = True


def lin(hexstr):
    h = hexstr.lstrip('#')
    c = [int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c]


def floats(s, dtype=np.float32):
    return np.frombuffer(base64.b64decode(s), dtype=dtype)


# ---- The fixtures: one object of everything lit, one of what only casts shadows ----

materials = []
for i, albedo in enumerate(data['materials']):
    m = bpy.data.materials.new(f'm{i}')
    m.use_nodes = True
    bsdf = m.node_tree.nodes['Principled BSDF']
    bsdf.inputs['Base Color'].default_value = (*lin(albedo), 1)
    bsdf.inputs['Roughness'].default_value = 0.9
    materials.append(m)


def build(name, meshes):
    verts, faces, mats, normals = [], [], [], []
    for mesh in meshes:
        pos = floats(mesh['pos']).reshape(-1, 3)
        nrm = floats(mesh['nrm']).reshape(-1, 3) if mesh['nrm'] else None
        mat = floats(mesh['mat'], np.uint16)
        # Corners at the same place, within one fixture, become one vertex, so islands hold together
        seen = {}
        ids = []
        for p in pos:
            k = (round(float(p[0]), 5), round(float(p[1]), 5), round(float(p[2]), 5))
            if k not in seen:
                seen[k] = len(verts)
                verts.append(tuple(map(float, p)))
            ids.append(seen[k])
        for t in range(len(pos) // 3):
            a, b, c = ids[3 * t:3 * t + 3]
            if a == b or b == c or a == c:
                # Too thin to weld: its own corners
                base = len(verts)
                verts.extend(tuple(map(float, pos[3 * t + j])) for j in range(3))
                a, b, c = base, base + 1, base + 2
            faces.append((a, b, c))
            mats.append(int(mat[t]))
            for j in range(3):
                normals.append(tuple(map(float, nrm[3 * t + j])) if nrm is not None else (0.0, 0.0, 1.0))
    me = bpy.data.meshes.new(name)
    me.from_pydata(verts, [], faces)
    for m in materials:
        me.materials.append(m)
    me.polygons.foreach_set('material_index', mats)
    me.polygons.foreach_set('use_smooth', [True] * len(faces))
    me.normals_split_custom_set(normals)
    obj = bpy.data.objects.new(name, me)
    scene.collection.objects.link(obj)
    return obj, len(faces)


targets = [m for m in data['meshes'] if m['target']]
lit, nfaces = build('Lit', targets)
build('Occluders', [m for m in data['meshes'] if not m['target']])

# ---- Lightmap uvs: islands by angle, packed into the square ----
bpy.context.view_layer.objects.active = lit
lit.select_set(True)
uv = lit.data.uv_layers.new(name='lightmap')
lit.data.uv_layers.active = uv
bpy.ops.object.mode_set(mode='EDIT')
bpy.ops.mesh.select_all(action='SELECT')
bpy.ops.uv.smart_project(angle_limit=math.radians(62), island_margin=0.0, area_weight=0.0,
                         correct_aspect=True, scale_to_bounds=False)
bpy.ops.uv.pack_islands(rotate=True, margin=6 / SIZE)
bpy.ops.object.mode_set(mode='OBJECT')

coords = np.zeros(nfaces * 3 * 2, np.float32)
uv.data.foreach_get('uv', coords)
packed = np.clip(np.round(coords * 65535), 0, 65535).astype(np.uint16)
json.dump({
    'corners': [m['corners'] for m in targets],
    'uv': base64.b64encode(packed.tobytes()).decode(),
}, open(os.path.join(OUT, f'{PLACE}.json'), 'w'))

# ---- The bake target: every lit material writes into the same image ----
image = bpy.data.images.new('bake', SIZE, SIZE, float_buffer=True)
for m in materials:
    n = m.node_tree.nodes.new('ShaderNodeTexImage')
    n.image = image
    m.node_tree.nodes.active = n

# ---- The lights, each in its layer's collection ----
groups = {}
for layer in LAYERS:
    c = bpy.data.collections.new(layer)
    scene.collection.children.link(c)
    groups[layer] = c


def point(layer, at, colour, watts, radius):
    l = bpy.data.lights.new('p', 'POINT')
    l.energy = watts
    l.color = lin(colour)
    l.shadow_soft_size = radius
    o = bpy.data.objects.new('p', l)
    o.location = (at[0], -at[2], at[1])
    groups[layer].objects.link(o)
    return o


def area(layer, at, colour, watts, w, h, facing):
    """A soft panel; `facing` is the way it shines, in the app's axes"""
    l = bpy.data.lights.new('a', 'AREA')
    l.energy = watts
    l.color = lin(colour)
    l.shape = 'RECTANGLE'
    l.size = max(w, 0.02)
    l.size_y = max(h, 0.02)
    o = bpy.data.objects.new('a', l)
    o.location = (at[0], -at[2], at[1])
    f = (facing[0], -facing[2], facing[1])
    o.rotation_mode = 'QUATERNION'
    o.rotation_quaternion = Vector(f).to_track_quat('-Z', 'Y')
    groups[layer].objects.link(o)
    return o


inside = ENV['inside']
for light in data['lights']:
    k, layer, at, size, colour = light['kind'], light['layer'], light['at'], light['size'], light['color']
    if layer not in groups:
        continue
    if k == 'lamp':
        point(layer, at, colour, 9 * ENV['lampPower'], 0.05)
    elif k == 'room':
        point(layer, at, colour, (1.3 if PLACE == 'shop' else 1.0) * inside, 0.025)
    elif k == 'awning':
        point(layer, at, colour, 0.9 * inside, 0.025)
    elif k == 'neon':
        area(layer, at, colour, 7, size[0], size[1], (0, 0, 1))
        area(layer, at, colour, 3, size[0], size[1], (0, 0, -1))
    elif k == 'screen':
        area(layer, [at[0], at[1] + 0.05, at[2] + 0.1], colour, 10, size[0] * 0.9, size[1] * 0.7, (0, 0, 1))
    elif k == 'window':
        area(layer, at, colour, 6, size[2], size[1], (1, 0, 0))
    elif k == 'sill':
        point(layer, at, colour, 5, 0.04)

# The room's fill: the light off its bulbs, bouncing round inside it, as the app's two room lights
if 'room' in groups:
    for z in (-0.8, -1.7):
        point('room', [0, 2.3, z], '#FFB45E', 12 * inside, 0.5)

# The moon and the night sky, for the base layer only
moon = bpy.data.lights.new('moon', 'SUN')
moon.color = lin(ENV['key'])
moon.energy = ENV['keyPower'] * 1.6
moon.angle = math.radians(6)
mo = bpy.data.objects.new('moon', moon)
ka = ENV['keyAt']
mo.rotation_mode = 'QUATERNION'
mo.rotation_quaternion = Vector((-ka[0], ka[2], -ka[1])).to_track_quat('-Z', 'Y')
groups['base'].objects.link(mo)

# The door, shut, while the room's baked: its light stays in until the door opens
door = None
if 'room' in groups:
    bpy.ops.mesh.primitive_cube_add(size=1)
    door = bpy.context.active_object
    door.scale = (DW, 0.05, DH)
    door.location = (HX + DW / 2, -0.03, DH / 2)
    door.hide_render = True

world = scene.world.node_tree.nodes['Background']


def bake(layer):
    for name, c in groups.items():
        c.hide_render = name != layer
    if layer == 'base':
        sky = lin(ENV['sky'])
        world.inputs['Color'].default_value = (*sky, 1)
        world.inputs['Strength'].default_value = ENV['hemi'] * 0.5
    else:
        world.inputs['Strength'].default_value = 0.0
    if door:
        door.hide_render = layer != 'room'
    for o in bpy.context.selected_objects:
        o.select_set(False)
    lit.select_set(True)
    bpy.context.view_layer.objects.active = lit
    bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8, margin_type='EXTEND',
                        use_clear=True)
    px = np.array(image.pixels[:], np.float32).reshape(SIZE, SIZE, 4)
    light = px[..., :3]
    print(f'{layer}: max {light.max():.3f}  p99 {np.percentile(light, 99):.3f}  mean {light.mean():.4f}', flush=True)
    enc = np.sqrt(np.clip(light / RANGE, 0, 1))
    out = bpy.data.images.new(f'{layer}-out', SIZE, SIZE, alpha=False)
    out.colorspace_settings.name = 'Non-Color'
    rgba = np.concatenate([enc, np.ones((SIZE, SIZE, 1), np.float32)], -1)
    out.pixels.foreach_set(rgba.ravel())
    out.filepath_raw = os.path.join(OUT, f'{PLACE}-{layer}.png')
    out.file_format = 'PNG'
    out.save()


for layer in LAYERS:
    bake(layer)

# ---- baked.ts: every place baked so far ----
places = [p for p in ('shop', 'home') if os.path.exists(os.path.join(OUT, f'{p}.json'))]
lines = [
    "import type { BakeData, Place } from './bake';",
    '',
    '/** Written by scripts/blender/corner_shop_bake.py: each place\'s bake, once it has one */',
    'export const BAKED: Partial<Record<Place, { data: BakeData; maps: number[] }>> = {',
]
LAYER_SETS = {'shop': ['base', 'room', 'awning', 'neon'], 'home': ['base', 'room']}
for p in places:
    lines.append(f'  {p}: {{')
    lines.append(f"    data: require('../../../assets/corner-shop/bake/{p}.json'),")
    lines.append('    maps: [')
    for layer in LAYER_SETS[p]:
        lines.append(f"      require('../../../assets/corner-shop/bake/{p}-{layer}.png'),")
    lines.append('    ],')
    lines.append('  },')
lines.append('};')
open(os.path.join(ROOT, 'src', 'demos', 'corner-shop', 'baked.ts'), 'w').write('\n'.join(lines) + '\n')
print('done', PLACE, flush=True)
