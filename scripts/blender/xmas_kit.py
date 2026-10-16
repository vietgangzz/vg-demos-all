"""
Shared kit for the Christmas Eve scenes: paper materials, cut-paper shapes, and the export that
bakes a scene down for the app.

Every scene is papercraft: card cut to shape and given thickness, so each piece has a pale cut
edge; paper with fibres in it; patterns printed on. The light is baked in Cycles, in layers the app
can play with separately (the room's own light, the fire, the tree lights), and the colour on its
own at a higher resolution.
"""

import base64
import json
import math
import os

import bmesh
import bpy
import numpy as np
from mathutils import Matrix, Vector

# ---- Scene ----


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    prefs = bpy.context.preferences.addons['cycles'].preferences
    prefs.compute_device_type = 'METAL'
    prefs.get_devices()
    for d in prefs.devices:
        d.use = d.type == 'METAL'
    s = bpy.context.scene
    s.render.engine = 'CYCLES'
    s.cycles.device = 'GPU'
    s.view_settings.view_transform = 'Standard'
    return s


def rgb(h, a=1.0):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)) + (a,)


def srgb_to_linear(c):
    return tuple(((x + 0.055) / 1.055) ** 2.4 if x > 0.04045 else x / 12.92 for x in c[:3]) + (1,)


def lin(h):
    """A hex colour as Blender wants it in a colour socket (linear)"""
    return srgb_to_linear(rgb(h))


# ---- Materials ----

_mats = {}


def _node(nt, kind, loc=(0, 0), **props):
    n = nt.nodes.new(kind)
    n.location = loc
    for k, v in props.items():
        if k.startswith('in_'):
            n.inputs[k[3:].replace('_', ' ')].default_value = v
        else:
            setattr(n, k, v)
    return n


def paper(name, colour, rough=0.9, fiber=0.1, pattern=None, emit=None, emit_strength=0.0, sheen=0.0, metal=0.0):
    """
    Paper: a flat colour with fibres through it (a little in the colour, a little in the bump).
    pattern(nt, coord) can return a colour socket to print on it instead of the flat colour.
    """
    key = name
    if key in _mats:
        return _mats[key]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    bsdf = nt.nodes['Principled BSDF']
    bsdf.inputs['Roughness'].default_value = rough
    bsdf.inputs['Metallic'].default_value = metal
    coord = _node(nt, 'ShaderNodeTexCoord').outputs['Object']
    fibres = _node(nt, 'ShaderNodeTexNoise', in_Scale=180.0, in_Detail=6.0, in_Roughness=0.7)
    nt.links.new(coord, fibres.inputs['Vector'])
    stretch = _node(nt, 'ShaderNodeMapping')
    stretch.inputs['Scale'].default_value = (1, 1, 6)
    nt.links.new(coord, stretch.inputs['Vector'])
    long_fibre = _node(nt, 'ShaderNodeTexNoise', in_Scale=60.0, in_Detail=3.0)
    nt.links.new(stretch.outputs['Vector'], long_fibre.inputs['Vector'])
    base = pattern(nt, coord) if pattern else None
    if base is None:
        rgbn = _node(nt, 'ShaderNodeRGB')
        rgbn.outputs[0].default_value = lin(colour)
        base = rgbn.outputs[0]
    # Fibres darken and lighten the colour a touch
    mix = _node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type='OVERLAY')
    mix.inputs['Factor'].default_value = fiber
    nt.links.new(base, mix.inputs['A'])
    nt.links.new(fibres.outputs['Fac'], mix.inputs['B'])
    nt.links.new(mix.outputs['Result'], bsdf.inputs['Base Color'])
    bump = _node(nt, 'ShaderNodeBump', in_Strength=0.18, in_Distance=0.002)
    add = _node(nt, 'ShaderNodeMath', operation='ADD')
    nt.links.new(fibres.outputs['Fac'], add.inputs[0])
    nt.links.new(long_fibre.outputs['Fac'], add.inputs[1])
    nt.links.new(add.outputs[0], bump.inputs['Height'])
    nt.links.new(bump.outputs['Normal'], bsdf.inputs['Normal'])
    if sheen:
        bsdf.inputs['Sheen Weight'].default_value = sheen
    if emit:
        bsdf.inputs['Emission Color'].default_value = lin(emit)
        bsdf.inputs['Emission Strength'].default_value = emit_strength
    m['flat'] = colour
    _mats[key] = m
    return m


def glow(name, colour, strength):
    """Pure light: bulbs, flames, lit windows"""
    if name in _mats:
        return _mats[name]
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    nt = m.node_tree
    nt.nodes.remove(nt.nodes['Principled BSDF'])
    e = _node(nt, 'ShaderNodeEmission', in_Strength=strength)
    e.inputs['Color'].default_value = lin(colour)
    nt.links.new(e.outputs[0], nt.nodes['Material Output'].inputs['Surface'])
    m['glow'] = colour
    _mats[name] = m
    return m


# Patterns, printed on paper


def stripes(colours, scale, axis='X', soft=0.02):
    def make(nt, coord):
        sep = _node(nt, 'ShaderNodeSeparateXYZ')
        nt.links.new(coord, sep.inputs[0])
        mul = _node(nt, 'ShaderNodeMath', operation='MULTIPLY')
        mul.inputs[1].default_value = scale
        nt.links.new(sep.outputs[axis], mul.inputs[0])
        fr = _node(nt, 'ShaderNodeMath', operation='FRACT')
        nt.links.new(mul.outputs[0], fr.inputs[0])
        ramp = _node(nt, 'ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.interpolation = 'CONSTANT'
        n = len(colours)
        cr.elements[0].position = 0
        cr.elements[0].color = lin(colours[0])
        cr.elements[1].position = 1 / n
        cr.elements[1].color = lin(colours[1 % n])
        for k in range(2, n):
            e = cr.elements.new(k / n)
            e.color = lin(colours[k])
        nt.links.new(fr.outputs[0], ramp.inputs[0])
        return ramp.outputs['Color']
    return make


def dots(ground, dot, scale, size=0.18):
    """Little spots (or stars, from far enough) on a ground colour"""
    def make(nt, coord):
        vor = _node(nt, 'ShaderNodeTexVoronoi', in_Scale=scale, in_Randomness=0.0, voronoi_dimensions='2D')
        nt.links.new(coord, vor.inputs['Vector'])
        ramp = _node(nt, 'ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.elements[0].position = size * 0.85
        cr.elements[0].color = lin(dot)
        cr.elements[1].position = size
        cr.elements[1].color = lin(ground)
        nt.links.new(vor.outputs['Distance'], ramp.inputs[0])
        return ramp.outputs['Color']
    return make


def plaid(a, b, c, scale):
    def make(nt, coord):
        sep = _node(nt, 'ShaderNodeSeparateXYZ')
        nt.links.new(coord, sep.inputs[0])
        outs = []
        for axis in ('X', 'Y'):
            mul = _node(nt, 'ShaderNodeMath', operation='MULTIPLY')
            mul.inputs[1].default_value = scale
            nt.links.new(sep.outputs[axis], mul.inputs[0])
            s = _node(nt, 'ShaderNodeMath', operation='SINE')
            nt.links.new(mul.outputs[0], s.inputs[0])
            g = _node(nt, 'ShaderNodeMath', operation='GREATER_THAN')
            g.inputs[1].default_value = 0.35
            nt.links.new(s.outputs[0], g.inputs[0])
            outs.append(g.outputs[0])
        both = _node(nt, 'ShaderNodeMath', operation='ADD')
        nt.links.new(outs[0], both.inputs[0])
        nt.links.new(outs[1], both.inputs[1])
        ramp = _node(nt, 'ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.interpolation = 'CONSTANT'
        cr.elements[0].color = lin(a)
        cr.elements[1].position = 0.4
        cr.elements[1].color = lin(b)
        e = cr.elements.new(0.9)
        e.color = lin(c)
        mul = _node(nt, 'ShaderNodeMath', operation='MULTIPLY')
        mul.inputs[1].default_value = 0.5
        nt.links.new(both.outputs[0], mul.inputs[0])
        nt.links.new(mul.outputs[0], ramp.inputs[0])
        return ramp.outputs['Color']
    return make


def planks(a, b, width, length):
    """Floorboards: brick texture laid long, each board its own shade"""
    def make(nt, coord):
        brick = _node(nt, 'ShaderNodeTexBrick', in_Scale=1.0, in_Mortar_Size=0.004, in_Bias=0.0)
        brick.inputs['Brick Width'].default_value = length
        brick.inputs['Row Height'].default_value = width
        brick.inputs['Color1'].default_value = lin(a)
        brick.inputs['Color2'].default_value = lin(b)
        brick.inputs['Mortar'].default_value = lin('#3B2414')
        brick.offset = 0.37
        brick.offset_frequency = 1
        nt.links.new(coord, brick.inputs['Vector'])
        grain = _node(nt, 'ShaderNodeTexWave', wave_type='BANDS', in_Scale=14.0, in_Distortion=6.0, in_Detail=4.0)
        nt.links.new(coord, grain.inputs['Vector'])
        mix = _node(nt, 'ShaderNodeMix', data_type='RGBA', blend_type='MULTIPLY')
        mix.inputs['Factor'].default_value = 0.18
        nt.links.new(brick.outputs['Color'], mix.inputs['A'])
        nt.links.new(grain.outputs['Color'], mix.inputs['B'])
        return mix.outputs['Result']
    return make


def bricks(a, b, mortar, scale):
    def make(nt, coord):
        brick = _node(nt, 'ShaderNodeTexBrick', in_Scale=scale, in_Mortar_Size=0.018)
        brick.inputs['Color1'].default_value = lin(a)
        brick.inputs['Color2'].default_value = lin(b)
        brick.inputs['Mortar'].default_value = lin(mortar)
        brick.inputs['Brick Width'].default_value = 0.5
        brick.inputs['Row Height'].default_value = 0.22
        mapping = _node(nt, 'ShaderNodeMapping')
        mapping.inputs['Rotation'].default_value = (math.pi / 2, 0, 0)
        nt.links.new(coord, mapping.inputs['Vector'])
        nt.links.new(mapping.outputs['Vector'], brick.inputs['Vector'])
        return brick.outputs['Color']
    return make


def wallpaper(ground, stripe, motif, scale):
    """Stripes with a little motif between them, the way old wallpaper runs"""
    def make(nt, coord):
        st = stripes([ground, ground, stripe, ground, ground, stripe, stripe], scale, 'X')(nt, coord)
        vor = _node(nt, 'ShaderNodeTexVoronoi', in_Scale=scale * 2, in_Randomness=0.0, voronoi_dimensions='2D')
        swz = _node(nt, 'ShaderNodeMapping')
        swz.inputs['Rotation'].default_value = (math.pi / 2, 0, 0)
        nt.links.new(coord, swz.inputs['Vector'])
        coord = swz.outputs['Vector']
        nt.links.new(coord, vor.inputs['Vector'])
        ramp = _node(nt, 'ShaderNodeValToRGB')
        cr = ramp.color_ramp
        cr.elements[0].position = 0.06
        cr.elements[0].color = (1, 1, 1, 1)
        cr.elements[1].position = 0.08
        cr.elements[1].color = (0, 0, 0, 1)
        nt.links.new(vor.outputs['Distance'], ramp.inputs[0])
        mix = _node(nt, 'ShaderNodeMix', data_type='RGBA')
        nt.links.new(ramp.outputs['Color'], mix.inputs['Factor'])
        nt.links.new(st, mix.inputs['A'])
        mix.inputs['B'].default_value = lin(motif)
        return mix.outputs['Result']
    return make


# ---- Shapes ----

COLLECTION = {}


def link(obj, group='static'):
    bpy.context.scene.collection.objects.link(obj)
    obj['group'] = group
    return obj


def mesh_obj(name, bm, mats, group='static'):
    m = bpy.data.meshes.new(name)
    bm.to_mesh(m)
    bm.free()
    for mt in mats:
        m.materials.append(mt)
    o = bpy.data.objects.new(name, m)
    return link(o, group)


def cut(name, outline, depth, face, edge=None, at=(0, 0, 0), rot=(0, 0, 0), group='static', bevel=0.0):
    """
    A piece of card cut to `outline` (2D points in its XY plane) and `depth` thick, standing on Z.
    Faces get `face`, the cut sides `edge` (the pale core of the card).
    """
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, 0)) for x, y in outline]
    f = bm.faces.new(vs)
    if f.normal.z < 0:
        f.normal_flip()
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    top = [g for g in res['geom'] if isinstance(g, bmesh.types.BMVert)]
    for v in top:
        v.co.z += depth
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    for fc in bm.faces:
        fc.material_index = 0 if abs(fc.normal.z) > 0.7 else 1
    o = mesh_obj(name, bm, [face, edge or face], group)
    o.location = at
    o.rotation_euler = rot
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
    return o


def box(name, size, mat, at=(0, 0, 0), rot=(0, 0, 0), bevel=0.01, group='static', segments=3):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1)
    bmesh.ops.scale(bm, vec=size, verts=bm.verts)
    o = mesh_obj(name, bm, [mat], group)
    o.location = at
    o.rotation_euler = rot
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
    return o


def cyl(name, r, h, mat, at=(0, 0, 0), rot=(0, 0, 0), seg=32, r2=None, bevel=0.0, group='static', caps=True):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=caps, segments=seg, radius1=r, radius2=r if r2 is None else r2, depth=h)
    bmesh.ops.translate(bm, vec=(0, 0, h / 2), verts=bm.verts)
    for f in bm.faces:
        f.smooth = abs(f.normal.z) < 0.7
    o = mesh_obj(name, bm, [mat], group)
    o.location = at
    o.rotation_euler = rot
    if bevel:
        mod = o.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 2
        mod.limit_method = 'ANGLE'
    return o


def ball(name, r, mat, at=(0, 0, 0), scale=(1, 1, 1), group='static', seg=24):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=seg, v_segments=max(8, seg // 2), radius=r)
    for f in bm.faces:
        f.smooth = True
    o = mesh_obj(name, bm, [mat], group)
    o.location = at
    o.scale = scale
    return o


def tube(name, points, r, mat, group='static', taper=None, res=6, caps=True):
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = r
    cu.bevel_resolution = 2
    cu.use_fill_caps = caps
    sp = cu.splines.new('BEZIER')
    sp.bezier_points.add(len(points) - 1)
    for i, p in enumerate(points):
        bp = sp.bezier_points[i]
        bp.co = p
        bp.handle_left_type = bp.handle_right_type = 'AUTO'
        if taper:
            bp.radius = taper[i]
    sp.resolution_u = res
    cu.materials.append(mat)
    o = bpy.data.objects.new(name, cu)
    return link(o, group)


def torus(name, R, r, mat, at=(0, 0, 0), rot=(0, 0, 0), group='static', u=40, v=12):
    bm = bmesh.new()
    verts = []
    for i in range(u):
        a = 2 * math.pi * i / u
        for j in range(v):
            b = 2 * math.pi * j / v
            verts.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
    for i in range(u):
        for j in range(v):
            f = bm.faces.new((verts[i * v + j], verts[((i + 1) % u) * v + j], verts[((i + 1) % u) * v + (j + 1) % v], verts[i * v + (j + 1) % v]))
            f.smooth = True
    o = mesh_obj(name, bm, [mat], group)
    o.location = at
    o.rotation_euler = rot
    return o


def star_outline(points, r_out, r_in, rot=0.0):
    out = []
    for k in range(points * 2):
        a = rot + math.pi * k / points + math.pi / 2
        r = r_out if k % 2 == 0 else r_in
        out.append((math.cos(a) * r, math.sin(a) * r))
    return out


def circle_outline(r, n=32, sx=1.0, sy=1.0):
    return [(math.cos(2 * math.pi * k / n) * r * sx, math.sin(2 * math.pi * k / n) * r * sy) for k in range(n)]


def text(name, body, size, mat, at=(0, 0, 0), rot=(0, 0, 0), extrude=0.003, font=None, group='static', align='CENTER'):
    cu = bpy.data.curves.new(name, 'FONT')
    cu.body = body
    cu.size = size
    cu.extrude = extrude
    cu.align_x = align
    cu.align_y = 'CENTER'
    if font:
        cu.font = bpy.data.fonts.load(font)
    cu.materials.append(mat)
    o = bpy.data.objects.new(name, cu)
    o.location = at
    o.rotation_euler = rot
    return link(o, group)


def metaballs(name, elements, mat_for, resolution=0.012, group='static'):
    """elements: (kind, co, size or radius, material key). Converted to a mesh, faces coloured by
    the element they're nearest."""
    mb = bpy.data.metaballs.new(name)
    mb.resolution = resolution
    mb.render_resolution = resolution
    mb.threshold = 0.6
    obj = bpy.data.objects.new(name, mb)
    bpy.context.scene.collection.objects.link(obj)
    for kind, co, size, _ in elements:
        if kind == 'ball':
            e = mb.elements.new(type='BALL')
            e.radius = size
        else:
            e = mb.elements.new(type='ELLIPSOID')
            e.radius = 1
            e.size_x, e.size_y, e.size_z = size
        e.co = co
    dg = bpy.context.evaluated_depsgraph_get()
    m = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    keys = []
    for _, _, _, k in elements:
        if k not in keys:
            keys.append(k)
    for k in keys:
        m.materials.append(mat_for[k])
    for p in m.polygons:
        c = p.center
        best, bk = 1e9, keys[0]
        for kind, co, size, k in elements:
            s = (size, size, size) if kind == 'ball' else size
            d = Vector(((c.x - co[0]) / s[0], (c.y - co[1]) / s[1], (c.z - co[2]) / s[2])).length
            if d < best:
                best, bk = d, k
        p.material_index = keys.index(bk)
        p.use_smooth = True
    o = bpy.data.objects.new(name, m)
    return link(o, group)


def light(name, kind, at, energy, colour, size=0.1, rot=(0, 0, 0), group='base'):
    ld = bpy.data.lights.new(name, kind)
    ld.energy = energy
    ld.color = lin(colour)[:3]
    if kind == 'AREA':
        ld.size = size
    elif kind in ('POINT', 'SPOT'):
        ld.shadow_soft_size = size
    o = bpy.data.objects.new(name, ld)
    o.location = at
    o.rotation_euler = rot
    o['light_group'] = group
    bpy.context.scene.collection.objects.link(o)
    return o


# ---- Baking and export ----


def flatten_list(objs):
    """
    Turn curves, text and modifiers into plain mesh objects in world space. Every mesh is taken
    before any object goes, so children keep where their parents put them.
    """
    dg = bpy.context.evaluated_depsgraph_get()
    taken = []
    for o in objs:
        m = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        m.transform(o.matrix_world)
        taken.append((o, m))
    out = []
    for o, m in taken:
        n = bpy.data.objects.new(o.name + '_m', m)
        for k in o.keys():
            n[k] = o[k]
        bpy.context.scene.collection.objects.link(n)
        out.append(n)
    for o, _ in taken:
        bpy.data.objects.remove(o)
    return out


def flatten(group):
    objs = [o for o in list(bpy.context.scene.objects) if o.type in ('MESH', 'CURVE', 'FONT') and o.get('group') == group]
    return flatten_list(objs)


def flatten_join(group, name):
    """
    Everything in `group` as one mesh, in world space, modifiers applied: built straight into one
    bmesh rather than object by object (a town has tens of thousands of pieces)
    """
    dg = bpy.context.evaluated_depsgraph_get()
    objs = [o for o in list(bpy.context.scene.objects) if o.type in ('MESH', 'CURVE', 'FONT') and o.get('group') == group]
    bm = bmesh.new()
    mats = []
    index = {}
    for o in objs:
        m = bpy.data.meshes.new_from_object(o.evaluated_get(dg))
        m.transform(o.matrix_world)
        remap = []
        for mt in m.materials:
            key = mt.name if mt else ''
            if key not in index:
                index[key] = len(mats)
                mats.append(mt)
            remap.append(index[key])
        for poly in m.polygons:
            poly.material_index = remap[poly.material_index] if remap else 0
        bm.from_mesh(m)
        bpy.data.meshes.remove(m)
    bpy.data.batch_remove(objs)
    mesh = bpy.data.meshes.new(name)
    bm.to_mesh(mesh)
    bm.free()
    for mt in mats:
        mesh.materials.append(mt)
    o = bpy.data.objects.new(name, mesh)
    o['group'] = group
    bpy.context.scene.collection.objects.link(o)
    print(name, len(objs), 'pieces', len(mesh.polygons), 'faces')
    return o


def join(objs, name):
    bpy.ops.object.select_all(action='DESELECT')
    for o in objs:
        o.select_set(True)
    bpy.context.view_layer.objects.active = objs[0]
    bpy.ops.object.join()
    o = bpy.context.view_layer.objects.active
    o.name = name
    return o


def lightmap_uv(o, margin=0.004, pack=True):
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    m = o.data
    while m.uv_layers:
        m.uv_layers.remove(m.uv_layers[0])
    m.uv_layers.new(name='bake')
    bpy.ops.object.mode_set(mode='EDIT')
    bpy.ops.mesh.select_all(action='SELECT')
    bpy.ops.uv.smart_project(angle_limit=math.radians(60), island_margin=margin, area_weight=0.0, scale_to_bounds=True)
    if pack:
        # With tens of thousands of islands smart project leaves most of the map empty (a town used
        # 7% of it): packed tight, every surface gets several times the texels, and there's little
        # black between the islands to bleed into their edges
        bpy.ops.uv.select_all(action='SELECT')
        bpy.ops.uv.pack_islands(udim_source='CLOSEST_UDIM', rotate=True, scale=True, margin_method='FRACTION', margin=margin,
                                shape_method='AABB')
    bpy.ops.object.mode_set(mode='OBJECT')


def _bake_target(o, img):
    for mt in o.data.materials:
        nt = mt.node_tree
        for n in [n for n in nt.nodes if n.name == 'BAKE_TARGET']:
            nt.nodes.remove(n)
        t = nt.nodes.new('ShaderNodeTexImage')
        t.name = 'BAKE_TARGET'
        t.image = img
        nt.nodes.active = t


def set_lights(groups):
    for o in bpy.context.scene.objects:
        if o.type == 'LIGHT':
            o.hide_render = o.get('light_group') not in groups
    # Glowing surfaces only light the room when their group is on
    for mt in bpy.data.materials:
        if 'glow' in mt.keys():
            e = mt.node_tree.nodes.get('Emission')
            if e is not None:
                if 'strength' not in mt.keys():
                    mt['strength'] = e.inputs['Strength'].default_value
                on = mt.get('light_group', 'base') in groups
                e.inputs['Strength'].default_value = mt['strength'] if on else 0.0


def bake(o, kind, size, samples, out_path, groups=None, world_on=True):
    s = bpy.context.scene
    s.cycles.samples = samples
    img = bpy.data.images.new(os.path.basename(out_path), size, size, float_buffer=True, alpha=True)
    img.generated_color = (0, 0, 0, 0)
    _bake_target(o, img)
    bpy.ops.object.select_all(action='DESELECT')
    o.select_set(True)
    bpy.context.view_layer.objects.active = o
    if groups is not None:
        set_lights(groups)
    if s.world:
        s.world.node_tree.nodes['Background'].inputs['Strength'].default_value = s.world.get('strength', 1.0) if world_on else 0.0
    if kind == 'COLOR':
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'COLOR'}, margin=8)
    elif kind == 'EMIT':
        bpy.ops.object.bake(type='EMIT', margin=8)
    else:
        bpy.ops.object.bake(type='DIFFUSE', pass_filter={'DIRECT', 'INDIRECT'}, margin=8)
    px = np.array(img.pixels[:], np.float32).reshape(size, size, 4)
    return img, px


def save_png(px, path, scale=1.0, gamma=1.0):
    """Floats to an 8-bit PNG: divided by scale, then gamma (so dim light keeps its steps)"""
    h, w = px.shape[:2]
    img = bpy.data.images.new(os.path.basename(path), w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    out = np.ones((h, w, 4), np.float32)
    out[..., :3] = np.clip(px[..., :3] / scale, 0, 1) ** (1 / gamma)
    img.pixels.foreach_set(out.ravel())
    img.filepath_raw = path
    img.file_format = 'PNG' if path.endswith('.png') else 'JPEG'
    img.save()


def linear_to_srgb(px):
    a = np.clip(px, 0, None)
    return np.where(a <= 0.0031308, a * 12.92, 1.055 * np.power(a, 1 / 2.4) - 0.055)


def pushpull(px, island):
    """
    Fill the empty texels between the islands with the colour of the nearest islands: averaged down
    a pyramid of the map, then back up. Mipmaps average neighbouring texels; with black between the
    islands, every thin piece (a barge board, a roof's edge) would go dark at a distance, an outline.
    """
    h, w = island.shape
    c = px[..., :3] * island[..., None]
    wt = island.astype(np.float32)
    levels = [(c, wt)]
    while c.shape[0] > 1 and c.shape[1] > 1 and c.shape[0] % 2 == 0 and c.shape[1] % 2 == 0:
        c = c.reshape(c.shape[0] // 2, 2, c.shape[1] // 2, 2, 3).sum(axis=(1, 3))
        wt = wt.reshape(wt.shape[0] // 2, 2, wt.shape[1] // 2, 2).sum(axis=(1, 3))
        levels.append((c, wt))
    fill = levels[-1][0] / np.maximum(levels[-1][1], 1e-6)[..., None]
    for c, wt in reversed(levels[:-1]):
        up = np.repeat(np.repeat(fill, 2, axis=0), 2, axis=1)
        fill = np.where((wt > 0)[..., None], c / np.maximum(wt, 1e-6)[..., None], up)
    out = px.copy()
    out[..., :3] = np.where(island[..., None], px[..., :3], fill)
    return out


def denoise(px, island, r=2):
    """A light blur inside the islands, so a few hundred samples look like thousands"""
    out = px.copy()
    w = island.astype(np.float32)[..., None]
    acc = px * w
    wt = w.copy()
    for dy in range(-r, r + 1):
        for dx in range(-r, r + 1):
            if dx == 0 and dy == 0:
                continue
            k = math.exp(-(dx * dx + dy * dy) / (r * r))
            acc += np.roll(px * w, (dy, dx), (0, 1)) * k
            wt += np.roll(w, (dy, dx), (0, 1)) * k
    out[..., :3] = np.where(wt > 0, acc / np.maximum(wt, 1e-6), px)[..., :3]
    return out


TILE_SCALE = 1800.0


def tile_coords(o, is_roof):
    """
    A second UV layer, 'tiles', on a baked mesh: on every slope of tiles (faces whose material
    is_roof(name) says is a roof), where a point is on it in metres: u along the slope's rows, v down
    it from its top. The app lays every tile from these, sharper than any map could. Off the roofs: -1.
    """
    m = o.data
    layer = m.uv_layers.new(name='tiles')
    data = layer.data
    names = [mt.name if mt else '' for mt in m.materials]
    up = Vector((0, 0, 1))
    for poly in m.polygons:
        n = poly.normal
        roof = 0.2 < n.z < 0.985 and poly.material_index < len(names) and is_roof(names[poly.material_index])
        if not roof:
            for li in poly.loop_indices:
                data[li].uv = (-1.0, -1.0)
            continue
        rise = (up - n * n.dot(up)).normalized()
        across = Vector((-n.y, n.x, 0)).normalized()
        pts = [m.vertices[m.loops[li].vertex_index].co for li in poly.loop_indices]
        top = max(p.dot(rise) for p in pts)
        left = min(p.dot(across) for p in pts)
        for li, p in zip(poly.loop_indices, pts):
            data[li].uv = (p.dot(across) - left, top - p.dot(rise))
    # Bake (and draw) with the lightmap UVs
    m.uv_layers.active = m.uv_layers['bake']
    m.uv_layers['bake'].active_render = True


def pack_baked(o, pivot=(0, 0, 0)):
    """The baked mesh: positions (quantised to the box), lightmap UVs, indices; and where a roof has one, the 'tiles' UVs"""
    m = o.data
    m.calc_loop_triangles()
    uv = m.uv_layers['bake'].data
    tiles = m.uv_layers['tiles'].data if 'tiles' in m.uv_layers else None
    P, U, I, T = [], [], [], []
    index = {}
    for tri in m.loop_triangles:
        for loop in tri.loops:
            vi = m.loops[loop].vertex_index
            u = uv[loop].uv
            t = tiles[loop].uv if tiles else (0, 0)
            key = (vi, round(u.x, 5), round(u.y, 5), round(t[0], 3), round(t[1], 3))
            if key not in index:
                co = m.vertices[vi].co
                index[key] = len(P)
                # Blender (z up, y forward) to three (y up, z toward you)
                P.append((co.x - pivot[0], co.z - pivot[2], -(co.y - pivot[1])))
                U.append((u.x, u.y))
                T.append((t[0], t[1]))
            I.append(index[key])
    extra = None
    if tiles:
        t = np.array(T, np.float32)
        q = np.where(t < 0, 65535, np.clip(np.round(t * TILE_SCALE), 0, 65534)).astype(np.uint16)
        extra = {'t': base64.b64encode(q.tobytes()).decode(), 'tscale': TILE_SCALE}
    return _encode(P, U, I, extra)


def _encode(P, U, I, extra=None):
    p = np.array(P, np.float32)
    lo, hi = p.min(0), p.max(0)
    q = np.round((p - lo) / np.maximum(hi - lo, 1e-6) * 65535).astype(np.uint16)
    u = np.round(np.clip(np.array(U, np.float32), 0, 1) * 65535).astype(np.uint16)
    i = np.array(I, np.uint32 if len(P) > 65535 else np.uint16)
    enc = lambda a: base64.b64encode(a.tobytes()).decode()  # noqa: E731
    out = {'p': enc(q), 'lo': lo.round(5).tolist(), 'hi': hi.round(5).tolist(), 'uv': enc(u), 'i': enc(i), 'wide': len(P) > 65535}
    if extra:
        out.update(extra)
    print('   packed', len(P), 'verts', len(I) // 3, 'tris')
    return out


def write_json(path, data):
    with open(path, 'w') as f:
        json.dump(data, f, separators=(',', ':'))
    print('saved', path, os.path.getsize(path) // 1024, 'KB')


def pack_lit(objs, pivot=(0, 0, 0)):
    """Things that move: smooth normals and each material's flat colour on the vertices"""
    P, N, C, I = [], [], [], []
    for o in objs:
        m = o.data
        m.calc_loop_triangles()
        normals = m.corner_normals
        index = {}
        for tri in m.loop_triangles:
            mat = m.materials[tri.material_index] if m.materials else None
            colour = rgb(mat.get('flat', mat.get('glow', '#FFFFFF')))[:3] if mat else (1, 1, 1)
            for loop in tri.loops:
                vi = m.loops[loop].vertex_index
                n = normals[loop].vector
                key = (vi, tri.material_index, round(n.x, 2), round(n.y, 2), round(n.z, 2))
                if key not in index:
                    co = m.vertices[vi].co
                    index[key] = len(P)
                    P.append((co.x - pivot[0], co.z - pivot[2], -(co.y - pivot[1])))
                    N.append((n.x, n.z, -n.y))
                    C.append(colour)
                I.append(index[key])
    p = np.array(P, np.float32)
    n = np.clip(np.round(np.array(N) * 127), -127, 127).astype(np.int8)
    c = np.clip(np.round(np.array(C) * 255), 0, 255).astype(np.uint8)
    i = np.array(I, np.uint32 if len(P) > 65535 else np.uint16)
    enc = lambda a: base64.b64encode(a.tobytes()).decode()  # noqa: E731
    print('   lit', len(P), 'verts', len(I) // 3, 'tris')
    return {'p': enc(p), 'n': enc(n), 'c': enc(c), 'i': enc(i), 'wide': len(P) > 65535}


def three(v, pivot=(0, 0, 0)):
    """A Blender point in three's axes"""
    return [round(v[0] - pivot[0], 4), round(v[2] - pivot[2], 4), round(-(v[1] - pivot[1]), 4)]


def bake_export(objs, prefix, out, alb=4096, lit=1536, samples=384,
                layers=(('base', ['base'], True), ('tree', ['tree'], False)), margin=0.0025, emit=None, roofs=None):
    """Join objs into one mesh, bake its colour, its glow and its light layers, and pack it"""
    o = objs if not isinstance(objs, list) else (objs[0] if len(objs) == 1 else join(objs, prefix))
    o.name = prefix
    print(prefix, 'faces', len(o.data.polygons))
    lightmap_uv(o, margin=margin)
    if roofs:
        tile_coords(o, roofs)
    _, colour = bake(o, 'COLOR', alb, 4, prefix + '_albedo', groups=['base'])
    colour = pushpull(colour, colour[..., 3] > 0)
    save_png(linear_to_srgb(colour), os.path.join(out, prefix + '_albedo.jpg'))
    # The glow at the albedo's size: lit windows are only a few texels each, and at less they're lost
    _, glow = bake(o, 'EMIT', emit or alb, 1, prefix + '_emit', groups=['base'])
    # Lossless: a lit window is a few texels, and JPEG blurs a few bright texels away to nothing
    save_png(linear_to_srgb(glow), os.path.join(out, prefix + '_emit.png'))
    scales = {}
    for name, groups, world_on in layers:
        _, px = bake(o, 'LIGHT', lit, samples, prefix + '_' + name, groups=groups, world_on=world_on)
        px = denoise(px, px[..., 3] > 0, r=2)
        on = px[..., :3][px[..., 3] > 0]
        scale = max(0.05, float(np.percentile(on, 99.5)))
        scales[name] = round(scale, 4)
        px = pushpull(px, px[..., 3] > 0)
        save_png(px, os.path.join(out, f'{prefix}_{name}.png'), scale=scale, gamma=2.0)
        print('  light', prefix, name, scale)
    return {'mesh': pack_baked(o), 'light': scales}
