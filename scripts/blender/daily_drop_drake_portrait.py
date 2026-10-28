"""
Daily Drop: Ember Drake's portrait, for the avatar once it's yours.

Renders Quaternius's dragon (assets/daily-drop/creature/dragon.json) in the ember colours the scene
gives it (src/demos/daily-drop/creature.ts), mid hover, three quarters on, lit warm from above with
an orange rim, on a transparent background.

    blender -b -P scripts/blender/daily_drop_drake_portrait.py -- <out.png>
"""

import base64
import json
import math
import os
import sys
import tempfile

import bpy
from mathutils import Vector

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
out = sys.argv[sys.argv.index('--') + 1]

bpy.ops.wm.read_factory_settings(use_empty=True)
glb = os.path.join(tempfile.mkdtemp(), 'dragon.glb')
with open(os.path.join(ROOT, 'assets/daily-drop/creature/dragon.json')) as f:
    open(glb, 'wb').write(base64.b64decode(json.load(f)['glb']))
bpy.ops.import_scene.gltf(filepath=glb)
scene = bpy.context.scene


def srgb(h):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [1]


LOOK = {
    'Dragon_Main': ('#D8431A', None, 0.45),
    'Dragon_Secondary': ('#FF9A2E', ('#FF7A1A', 0.8), 0.5),
    'Dragon_Horn': ('#F2D9A6', None, 0.25),
    'Eye_White': ('#FFF4E2', None, 0.15),
    'Eye_Black': ('#1A0E08', None, 0.05),
}
for m in bpy.data.materials:
    look = LOOK.get(m.name)
    if not look or not m.node_tree:
        continue
    bsdf = next((n for n in m.node_tree.nodes if n.type == 'BSDF_PRINCIPLED'), None)
    if not bsdf:
        continue
    for link in list(bsdf.inputs['Base Color'].links):
        m.node_tree.links.remove(link)
    bsdf.inputs['Base Color'].default_value = srgb(look[0])
    bsdf.inputs['Roughness'].default_value = look[2]
    if look[1]:
        bsdf.inputs['Emission Color'].default_value = srgb(look[1][0])
        bsdf.inputs['Emission Strength'].default_value = look[1][1]

# Mid hover
arm = next(o for o in scene.objects if o.type == 'ARMATURE')
act = next(a for a in bpy.data.actions if a.name.endswith('Flying_Idle'))
arm.animation_data_create()
arm.animation_data.action = act
scene.frame_set(int(act.frame_range[0] + (act.frame_range[1] - act.frame_range[0]) * 0.3))

meshes = [o for o in scene.objects if o.type == 'MESH']
deps = bpy.context.evaluated_depsgraph_get()
lo = Vector((1e9,) * 3)
hi = Vector((-1e9,) * 3)
for o in meshes:
    ev = o.evaluated_get(deps)
    for v in ev.to_mesh().vertices:
        w = o.matrix_world @ v.co
        lo = Vector(map(min, lo, w))
        hi = Vector(map(max, hi, w))
    ev.to_mesh_clear()
size = hi - lo
# Framed on its head and chest
focus = Vector(((lo.x + hi.x) / 2, (lo.y + hi.y) / 2, lo.z + size.z * 0.7))

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.lens = 85
scene.collection.objects.link(cam)
d = max(size.x, size.z) * 2.0
cam.location = focus + Vector((math.sin(0.45) * d, -math.cos(0.45) * d, d * 0.22))
cam.rotation_euler = (focus - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.camera = cam


def light(name, kind, energy, colour, loc, size=1.0):
    l = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
    l.data.energy = energy
    l.data.color = srgb(colour)[:3]
    if kind == 'AREA':
        l.data.size = size
    l.location = focus + Vector(loc)
    l.rotation_euler = (focus - l.location).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(l)


s = max(size.x, size.z)
light('key', 'AREA', 220 * s * s, '#FFE2B0', (-s * 1.2, -s * 1.6, s * 2.0), s)
light('rim', 'AREA', 400 * s * s, '#FF7A1A', (s * 1.5, s * 1.8, s * 0.8), s)
light('fill', 'AREA', 60 * s * s, '#8E63FF', (s * 1.6, -s * 1.2, -s * 0.4), s)

world = bpy.data.worlds.new('w')
world.color = (0.02, 0.012, 0.02)
scene.world = world
scene.render.film_transparent = True
scene.render.resolution_x = 512
scene.render.resolution_y = 512
scene.view_settings.view_transform = 'Standard'
scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('portrait', out)
