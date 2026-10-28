"""
Daily Drop: the XP tile's art, painted to sit beside the coins and gems.

An orb of glass with a swirling cyan nebula of light inside it, held in a gold claw stand, rings of
light orbiting it, motes of light drifting round, out of focus, in a deep blue dark. Rendered in
Cycles, with a soft bloom.

    blender -b -P scripts/blender/daily_drop_xp_art.py -- xp.png
    magick xp.png \( +clone -level 45%,100% -blur 0x22 \) -compose screen -composite \
      \( +clone -level 70%,100% -blur 0x6 \) -compose screen -composite -modulate 100,130 \
      assets/daily-drop/art/card-xp.png
"""

import math
import random
import sys

import bpy
from mathutils import Vector

out = sys.argv[sys.argv.index('--') + 1]
random.seed(11)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene


def srgb(h, a=1.0):
    c = [int(h[i : i + 2], 16) / 255 for i in (1, 3, 5)]
    return [x / 12.92 if x <= 0.04045 else ((x + 0.055) / 1.055) ** 2.4 for x in c] + [a]


def material(name):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    return m, m.node_tree.nodes, m.node_tree.links


def emissive(name, colour, strength):
    m, n, l = material(name)
    n.clear()
    e = n.new('ShaderNodeEmission')
    e.inputs['Color'].default_value = srgb(colour)
    e.inputs['Strength'].default_value = strength
    o = n.new('ShaderNodeOutputMaterial')
    l.new(e.outputs[0], o.inputs[0])
    return m


def gold():
    m, n, _ = material('gold')
    b = n['Principled BSDF']
    b.inputs['Base Color'].default_value = srgb('#FFC24A')
    b.inputs['Metallic'].default_value = 1
    b.inputs['Roughness'].default_value = 0.22
    return m


def glass():
    m, n, l = material('glass')
    n.clear()
    g = n.new('ShaderNodeBsdfGlass')
    g.inputs['Color'].default_value = srgb('#E6FBFF')
    g.inputs['IOR'].default_value = 1.45
    g.inputs['Roughness'].default_value = 0.02
    o = n.new('ShaderNodeOutputMaterial')
    l.new(g.outputs[0], o.inputs[0])
    return m


def nebula():
    """A volume of light: swirling noise, cyan to white hot in its folds"""
    m, n, l = material('nebula')
    n.clear()
    co = n.new('ShaderNodeTexCoord')
    warp = n.new('ShaderNodeTexNoise')
    warp.inputs['Scale'].default_value = 1.6
    warp.inputs['Detail'].default_value = 6
    mix = n.new('ShaderNodeVectorMath')
    mix.operation = 'MULTIPLY_ADD'
    mix.inputs[1].default_value = (2.6, 2.6, 2.6)
    noise = n.new('ShaderNodeTexNoise')
    noise.inputs['Scale'].default_value = 2.6
    noise.inputs['Detail'].default_value = 10
    noise.inputs['Roughness'].default_value = 0.62
    ramp = n.new('ShaderNodeValToRGB')
    r = ramp.color_ramp
    r.elements[0].position = 0.56
    r.elements[0].color = (0, 0, 0, 1)
    r.elements[1].position = 0.82
    r.elements[1].color = (1, 1, 1, 1)
    tint = n.new('ShaderNodeValToRGB')
    t = tint.color_ramp
    t.elements[0].color = srgb('#0030E0')
    t.elements[1].color = srgb('#B8FAFF')
    t.elements.new(0.45).color = srgb('#00D2FF')
    em = n.new('ShaderNodeEmission')
    strength = n.new('ShaderNodeMath')
    strength.operation = 'MULTIPLY'
    strength.inputs[1].default_value = 26
    vol = n.new('ShaderNodeVolumePrincipled')
    vol.inputs['Density'].default_value = 0.0
    o = n.new('ShaderNodeOutputMaterial')
    l.new(co.outputs['Object'], warp.inputs['Vector'])
    l.new(warp.outputs['Color'], mix.inputs[0])
    l.new(co.outputs['Object'], mix.inputs[2])
    l.new(mix.outputs[0], noise.inputs['Vector'])
    l.new(noise.outputs['Fac'], ramp.inputs['Fac'])
    l.new(ramp.outputs['Color'], tint.inputs['Fac'])
    l.new(tint.outputs['Color'], vol.inputs['Emission Color'])
    # Brightest at its heart, the filaments fading out toward the glass
    heart = n.new('ShaderNodeTexGradient')
    heart.gradient_type = 'SPHERICAL'
    falloff = n.new('ShaderNodeMath')
    falloff.operation = 'POWER'
    falloff.inputs[1].default_value = 1.6
    lift = n.new('ShaderNodeMath')
    lift.operation = 'MULTIPLY_ADD'
    lift.inputs[1].default_value = 2.2
    lift.inputs[2].default_value = 0.15
    both = n.new('ShaderNodeMath')
    both.operation = 'MULTIPLY'
    l.new(co.outputs['Object'], heart.inputs['Vector'])
    l.new(heart.outputs['Fac'], falloff.inputs[0])
    l.new(falloff.outputs[0], lift.inputs[0])
    l.new(ramp.outputs['Color'], both.inputs[0])
    l.new(lift.outputs[0], both.inputs[1])
    l.new(both.outputs[0], strength.inputs[0])
    l.new(strength.outputs[0], vol.inputs['Emission Strength'])
    l.new(vol.outputs[0], o.inputs['Volume'])
    return m


def add(obj, mat):
    obj.data.materials.append(mat)
    for p in getattr(obj.data, 'polygons', []):
        p.use_smooth = True
    return obj


# The orb and the nebula in it
bpy.ops.mesh.primitive_uv_sphere_add(segments=96, ring_count=48, radius=1, location=(0, 0, 0))
add(bpy.context.object, glass())
bpy.ops.mesh.primitive_uv_sphere_add(segments=64, ring_count=32, radius=0.94, location=(0, 0, 0))
add(bpy.context.object, nebula())

# A soft heart of light in it: a glowing volume, so it has no hard edge
bpy.ops.mesh.primitive_uv_sphere_add(segments=48, ring_count=24, radius=0.42, location=(0, 0, 0.05))
m, n, l = material('heart')
n.clear()
v = n.new('ShaderNodeVolumePrincipled')
v.inputs['Density'].default_value = 0.0
v.inputs['Emission Color'].default_value = srgb('#9FF4FF')
# (Falling off smoothly from its middle: a glow, not a ball)
co = n.new('ShaderNodeTexCoord')
g = n.new('ShaderNodeTexGradient')
g.gradient_type = 'SPHERICAL'
mp = n.new('ShaderNodeMapping')
mp.inputs['Scale'].default_value = (1 / 0.42, 1 / 0.42, 1 / 0.42)
pw = n.new('ShaderNodeMath')
pw.operation = 'POWER'
pw.inputs[1].default_value = 3.0
k = n.new('ShaderNodeMath')
k.operation = 'MULTIPLY'
k.inputs[1].default_value = 9.0
o = n.new('ShaderNodeOutputMaterial')
l.new(co.outputs['Object'], mp.inputs['Vector'])
l.new(mp.outputs[0], g.inputs['Vector'])
l.new(g.outputs['Fac'], pw.inputs[0])
l.new(pw.outputs[0], k.inputs[0])
l.new(k.outputs[0], v.inputs['Emission Strength'])
l.new(v.outputs[0], o.inputs['Volume'])
add(bpy.context.object, m)

# The stand: a gold ring under it, claws curling up round it, a foot
G = gold()
bpy.ops.mesh.primitive_torus_add(major_radius=0.78, minor_radius=0.07, location=(0, 0, -0.66))
add(bpy.context.object, G)
bpy.ops.mesh.primitive_torus_add(major_radius=0.5, minor_radius=0.05, location=(0, 0, -1.02))
add(bpy.context.object, G)
bpy.ops.mesh.primitive_cone_add(vertices=48, radius1=0.62, radius2=0.42, depth=0.3, location=(0, 0, -1.2))
add(bpy.context.object, G)
# A crown of gold points round the ring, leaning in on it
for k in range(8):
    a = k * math.pi / 4
    bpy.ops.mesh.primitive_cone_add(
        vertices=16, radius1=0.07, radius2=0.0, depth=0.42, location=(math.cos(a) * 0.8, math.sin(a) * 0.8, -0.48)
    )
    point = add(bpy.context.object, G)
    point.rotation_euler = (0, -0.35, a)
    point.rotation_mode = 'XYZ'
    point.rotation_euler = (math.sin(a) * 0.35, -math.cos(a) * 0.35, 0)

# Rings of light orbiting it, tilted
for tilt, spin, r, s in [(1.2, 0.4, 1.35, 2.2), (1.85, -0.6, 1.6, 1.2)]:
    bpy.ops.mesh.primitive_torus_add(major_radius=r, minor_radius=0.006, major_segments=128, location=(0, 0, 0))
    ring = add(bpy.context.object, emissive('ring', '#7FF2FF', s))
    ring.rotation_euler = (tilt, spin, 0)

# Motes of light round it, near and far (the near ones go to bokeh)
mote = emissive('mote', '#BFF8FF', 25)
bokeh = emissive('bokeh', '#5FD8FF', 1.5)
for i in range(60):
    near = i < 14
    p = Vector(
        (
            random.uniform(-1.6, 1.6) if near else random.uniform(-3.2, 3.2),
            random.uniform(-5, -3.6) if near else random.uniform(-1.5, 3),
            random.uniform(-1.5, 1.8) if near else random.uniform(-2.8, 3.4),
        )
    )
    if p.length < 1.5:
        continue
    bpy.ops.mesh.primitive_ico_sphere_add(
        subdivisions=2, radius=random.uniform(0.02, 0.05) if near else random.uniform(0.008, 0.025), location=p
    )
    add(bpy.context.object, bokeh if near else mote)

# A deep blue dark behind it, glowing teal round where the orb is
bpy.ops.mesh.primitive_plane_add(size=30, location=(0, 6, 0), rotation=(math.pi / 2, 0, 0))
back = bpy.context.object
m, n, l = material('back')
n.clear()
co = n.new('ShaderNodeTexCoord')
grad = n.new('ShaderNodeTexGradient')
grad.gradient_type = 'SPHERICAL'
mapping = n.new('ShaderNodeMapping')
mapping.inputs['Scale'].default_value = (0.16, 0.16, 0.16)
ramp = n.new('ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = srgb('#040814')
ramp.color_ramp.elements[1].color = srgb('#1A6C8C')
ramp.color_ramp.elements[1].position = 0.92
ramp.color_ramp.elements.new(0.6).color = srgb('#0B2747')
em = n.new('ShaderNodeEmission')
em.inputs['Strength'].default_value = 1.0
o = n.new('ShaderNodeOutputMaterial')
l.new(co.outputs['Object'], mapping.inputs['Vector'])
l.new(mapping.outputs[0], grad.inputs['Vector'])
l.new(grad.outputs['Fac'], ramp.inputs['Fac'])
l.new(ramp.outputs['Color'], em.inputs['Color'])
l.new(em.outputs[0], o.inputs[0])
back.data.materials.append(m)

# Light: cyan from inside it (a point in the orb lights the stand), a warm key, a cool rim
for name, kind, energy, colour, loc in [
    ('inner', 'POINT', 90, '#5FE8FF', (0, 0, 0)),
    ('key', 'AREA', 300, '#FFE2B0', (-2.5, -3, 3)),
    ('rim', 'AREA', 500, '#3FA8FF', (2.5, 3, 2)),
]:
    lamp = bpy.data.objects.new(name, bpy.data.lights.new(name, kind))
    lamp.data.energy = energy
    lamp.data.color = srgb(colour)[:3]
    if kind == 'AREA':
        lamp.data.shape = 'DISK'
        lamp.data.size = 0.8
    if kind == 'POINT':
        lamp.data.shadow_soft_size = 0.3
        # (Not seen itself through the glass: only what it lights)
        lamp.visible_glossy = False
        lamp.visible_transmission = False
        lamp.visible_camera = False
    lamp.location = loc
    lamp.rotation_euler = (-Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
    scene.collection.objects.link(lamp)

world = bpy.data.worlds.new('w')
world.color = (0.003, 0.006, 0.014)
scene.world = world

cam = bpy.data.objects.new('cam', bpy.data.cameras.new('cam'))
cam.data.lens = 60
cam.data.dof.use_dof = True
cam.data.dof.focus_distance = 7.2
cam.data.dof.aperture_fstop = 1.2
cam.location = (0, -7.2, 0.9)
cam.rotation_euler = (Vector((0, 0, -0.15)) - cam.location).to_track_quat('-Z', 'Y').to_euler()
scene.collection.objects.link(cam)
scene.camera = cam

scene.render.engine = 'CYCLES'
scene.cycles.samples = 160
scene.cycles.use_denoising = True
scene.cycles.volume_bounces = 1
scene.render.resolution_x = 512
scene.render.resolution_y = 768
scene.view_settings.view_transform = 'AgX'
scene.view_settings.look = 'AgX - Punchy'

# A soft bloom
scene.use_nodes = True
tree = scene.compositing_node_group if hasattr(scene, 'compositing_node_group') else scene.node_tree
if tree is None:
    tree = bpy.data.node_groups.new('comp', 'CompositorNodeTree')
    scene.compositing_node_group = tree
nodes = tree.nodes
for nd in list(nodes):
    if nd.bl_idname not in ('CompositorNodeRLayers', 'CompositorNodeComposite', 'NodeGroupOutput'):
        nodes.remove(nd)
rl = next((nd for nd in nodes if nd.bl_idname == 'CompositorNodeRLayers'), None) or nodes.new('CompositorNodeRLayers')
glare = nodes.new('CompositorNodeGlare')
for attr, value in [('glare_type', 'FOG_GLOW'), ('quality', 'HIGH'), ('size', 8)]:
    try:
        setattr(glare, attr, value)
    except Exception:
        pass
for key, value in [('Type', 'Fog Glow'), ('Size', 0.7), ('Strength', 0.8), ('Threshold', 0.8)]:
    if key in glare.inputs:
        try:
            glare.inputs[key].default_value = value
        except Exception:
            pass
sink = next((nd for nd in nodes if nd.bl_idname in ('CompositorNodeComposite', 'NodeGroupOutput')), None)
if sink is None:
    sink = nodes.new('NodeGroupOutput')
    tree.interface.new_socket('Image', in_out='OUTPUT', socket_type='NodeSocketColor')
tree.links.new(rl.outputs['Image'], glare.inputs[0])
tree.links.new(glare.outputs[0], sink.inputs[0])

scene.render.filepath = out
bpy.ops.render.render(write_still=True)
print('xp art', out)
