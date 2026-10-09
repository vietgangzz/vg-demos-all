"""
Bakes a set of kraft cardboard textures for the Corner Shop demo:
  cardboard_color.jpg   albedo: kraft brown, fibres, a faint mottle, the odd darker fleck
  cardboard_normal.png  tangent-space normals: the flutes showing through the liner, fibres, a few dents
  cardboard_edge.jpg    a cut edge: the wavy flute between two liners, for the panels' thin sides

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/cardboard.py -- <out dir>
"""

import os
import sys

import bpy

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.abspath('assets/corner-shop')
SIZE = 1024
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
scene.render.engine = 'CYCLES'
scene.cycles.device = 'CPU'
scene.cycles.samples = 16
scene.cycles.bake_type = 'DIFFUSE'


def node(nodes, kind, **props):
    n = nodes.new(kind)
    for k, v in props.items():
        setattr(n, k, v)
    return n


def plane(name):
    bpy.ops.mesh.primitive_plane_add(size=2)
    obj = bpy.context.active_object
    obj.name = name
    return obj


def target(nodes, name, colorspace):
    img = bpy.data.images.new(name, SIZE, SIZE, alpha=False, float_buffer=False)
    img.colorspace_settings.name = colorspace
    tex = node(nodes, 'ShaderNodeTexImage', image=img)
    nodes.active = tex
    return img


def save(img, filename, fmt):
    img.filepath_raw = os.path.join(OUT, filename)
    img.file_format = fmt
    if fmt == 'JPEG':
        scene.render.image_settings.quality = 90
    img.save()


def bake(kind, img, filename, fmt):
    scene.cycles.bake_type = kind
    if kind == 'DIFFUSE':
        scene.render.bake.use_pass_direct = False
        scene.render.bake.use_pass_indirect = False
        scene.render.bake.use_pass_color = True
    bpy.ops.object.bake(type=kind)
    save(img, filename, fmt)


# ---- The face: kraft liner over flutes ----
face = plane('Face')
mat = bpy.data.materials.new('Kraft')
mat.use_nodes = True
nodes, links = mat.node_tree.nodes, mat.node_tree.links
nodes.clear()
out = node(nodes, 'ShaderNodeOutputMaterial')
bsdf = node(nodes, 'ShaderNodeBsdfPrincipled')
links.new(bsdf.outputs['BSDF'], out.inputs['Surface'])
coord = node(nodes, 'ShaderNodeTexCoord')

# Fibres: noise stretched along the paper's grain
grain = node(nodes, 'ShaderNodeMapping')
grain.inputs['Scale'].default_value = (1.0, 14.0, 1.0)
links.new(coord.outputs['UV'], grain.inputs['Vector'])
fibre = node(nodes, 'ShaderNodeTexNoise')
fibre.inputs['Scale'].default_value = 60.0
fibre.inputs['Detail'].default_value = 12.0
fibre.inputs['Roughness'].default_value = 0.65
links.new(grain.outputs['Vector'], fibre.inputs['Vector'])

# Mottle: big soft patches where the pulp was thicker
mottle = node(nodes, 'ShaderNodeTexNoise')
mottle.inputs['Scale'].default_value = 3.5
mottle.inputs['Detail'].default_value = 4.0
links.new(coord.outputs['UV'], mottle.inputs['Vector'])

# Flecks: dark bits of recycled fibre
fleck = node(nodes, 'ShaderNodeTexVoronoi')
fleck.inputs['Scale'].default_value = 90.0
links.new(coord.outputs['UV'], fleck.inputs['Vector'])
fleckRamp = node(nodes, 'ShaderNodeValToRGB')
fleckRamp.color_ramp.elements[0].position = 0.0
fleckRamp.color_ramp.elements[0].color = (0, 0, 0, 1)
fleckRamp.color_ramp.elements[1].position = 0.035
fleckRamp.color_ramp.elements[1].color = (1, 1, 1, 1)
links.new(fleck.outputs['Distance'], fleckRamp.inputs['Fac'])

# Flutes: soft stripes across, showing through the liner
flute = node(nodes, 'ShaderNodeTexWave')
flute.wave_type = 'BANDS'
flute.bands_direction = 'X'
flute.inputs['Scale'].default_value = 9.0
flute.inputs['Distortion'].default_value = 0.4
flute.inputs['Detail'].default_value = 1.0
links.new(coord.outputs['UV'], flute.inputs['Vector'])

base = node(nodes, 'ShaderNodeValToRGB')
base.color_ramp.elements[0].position = 0.25
base.color_ramp.elements[0].color = (0.42, 0.27, 0.15, 1)
base.color_ramp.elements[1].position = 0.8
base.color_ramp.elements[1].color = (0.62, 0.43, 0.26, 1)
mix1 = node(nodes, 'ShaderNodeMath', operation='MULTIPLY_ADD')
links.new(fibre.outputs['Fac'], mix1.inputs[0])
mix1.inputs[1].default_value = 0.55
links.new(mottle.outputs['Fac'], mix1.inputs[2])
links.new(mix1.outputs[0], base.inputs['Fac'])
withFlute = node(nodes, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
withFlute.inputs['Factor'].default_value = 0.06
links.new(base.outputs['Color'], withFlute.inputs['A'])
links.new(flute.outputs['Color'], withFlute.inputs['B'])
withFleck = node(nodes, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
withFleck.inputs['Factor'].default_value = 0.5
links.new(withFlute.outputs['Result'], withFleck.inputs['A'])
links.new(fleckRamp.outputs['Color'], withFleck.inputs['B'])
links.new(withFleck.outputs['Result'], bsdf.inputs['Base Color'])

# Normals: the flutes and the fibres
height = node(nodes, 'ShaderNodeMath', operation='MULTIPLY_ADD')
links.new(flute.outputs['Fac'], height.inputs[0])
height.inputs[1].default_value = 0.6
links.new(fibre.outputs['Fac'], height.inputs[2])
bump = node(nodes, 'ShaderNodeBump')
bump.inputs['Strength'].default_value = 0.35
bump.inputs['Distance'].default_value = 0.02
links.new(height.outputs[0], bump.inputs['Height'])
links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])

face.data.materials.append(mat)
bpy.context.view_layer.objects.active = face
face.select_set(True)

img = target(nodes, 'color', 'sRGB')
bake('DIFFUSE', img, 'cardboard_color.jpg', 'JPEG')
img = target(nodes, 'normal', 'Non-Color')
bake('NORMAL', img, 'cardboard_normal.png', 'PNG')

# ---- The cut edge: two liners and the wavy flute between ----
bpy.data.objects.remove(face)
edge = plane('Edge')
mat2 = bpy.data.materials.new('Edge')
mat2.use_nodes = True
nodes, links = mat2.node_tree.nodes, mat2.node_tree.links
nodes.clear()
out = node(nodes, 'ShaderNodeOutputMaterial')
emit = node(nodes, 'ShaderNodeEmission')
links.new(emit.outputs['Emission'], out.inputs['Surface'])
coord = node(nodes, 'ShaderNodeTexCoord')
sep = node(nodes, 'ShaderNodeSeparateXYZ')
links.new(coord.outputs['UV'], sep.inputs['Vector'])
# The flute: a sine across x, filling the middle band in y
wave = node(nodes, 'ShaderNodeMath', operation='SINE')
scaleX = node(nodes, 'ShaderNodeMath', operation='MULTIPLY')
links.new(sep.outputs['X'], scaleX.inputs[0])
scaleX.inputs[1].default_value = 6.2832 * 24
links.new(scaleX.outputs[0], wave.inputs[0])
curve = node(nodes, 'ShaderNodeMath', operation='MULTIPLY_ADD')
links.new(wave.outputs[0], curve.inputs[0])
curve.inputs[1].default_value = 0.28
curve.inputs[2].default_value = 0.5
dist = node(nodes, 'ShaderNodeMath', operation='SUBTRACT')
links.new(sep.outputs['Y'], dist.inputs[0])
links.new(curve.outputs[0], dist.inputs[1])
absd = node(nodes, 'ShaderNodeMath', operation='ABSOLUTE')
links.new(dist.outputs[0], absd.inputs[0])
line = node(nodes, 'ShaderNodeMath', operation='LESS_THAN')
links.new(absd.outputs[0], line.inputs[0])
line.inputs[1].default_value = 0.05
# The liners top and bottom
top = node(nodes, 'ShaderNodeMath', operation='GREATER_THAN')
links.new(sep.outputs['Y'], top.inputs[0])
top.inputs[1].default_value = 0.86
bot = node(nodes, 'ShaderNodeMath', operation='LESS_THAN')
links.new(sep.outputs['Y'], bot.inputs[0])
bot.inputs[1].default_value = 0.14
paper = node(nodes, 'ShaderNodeMath', operation='MAXIMUM')
links.new(top.outputs[0], paper.inputs[0])
links.new(bot.outputs[0], paper.inputs[1])
solid = node(nodes, 'ShaderNodeMath', operation='MAXIMUM')
links.new(paper.outputs[0], solid.inputs[0])
links.new(line.outputs[0], solid.inputs[1])
ramp = node(nodes, 'ShaderNodeValToRGB')
ramp.color_ramp.elements[0].color = (0.16, 0.09, 0.04, 1)
ramp.color_ramp.elements[1].color = (0.6, 0.42, 0.25, 1)
links.new(solid.outputs[0], ramp.inputs['Fac'])
links.new(ramp.outputs['Color'], emit.inputs['Color'])
edge.data.materials.append(mat2)
bpy.context.view_layer.objects.active = edge
edge.select_set(True)
img = target(nodes, 'edge', 'sRGB')
scene.cycles.bake_type = 'EMIT'
bpy.ops.object.bake(type='EMIT')
save(img, 'cardboard_edge.jpg', 'JPEG')

print('baked to', OUT)
