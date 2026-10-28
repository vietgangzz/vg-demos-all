"""
Models Daily Drop's treasure chest and everything around it: a barrel-lidded chest of oak planks,
each with its own grain and a little crooked, bound in gilded straps with rivets, corner caps, a
shield-shaped lock plate with its keyhole, a hasp hanging off the lid over it, a ruby in a gold
bezel on the lid and ring handles at the sides; inside, a velvet lining and a heap of gold coins
and gems that shows when the lid comes up. Under it, a round stone dais with a gold trim and a
ring of runes cut into its top. The loose coin and gem that fly out of it. The key the padlock's
opened with, a glass bulb in its bow; and the legendary egg that comes up out of the chest, in a
gold cage. (Ember Fox, what hatches out of it, is daily_drop_fox.py's.)

Every vertex carries its colour, with ambient occlusion worked in (rays cast against the model in
place: the chest's own straps shade the planks round them, and the chest shades the dais it
stands on), and what it's made of: wood, end grain, gold, iron, velvet, coin, gem, stone, rune,
glow, the key's bulb or the egg's shell. The app gives each its own surface
(src/demos/daily-drop/models.ts).

Writes assets/daily-drop/models.json: for each part, indexed triangles with smooth normals, a
colour and a material per vertex, in three.js axes (y up, facing +z), base64 encoded:
  { name: { p: float32 xyz, n: int8 xyz, c: uint8 rgb, k: uint8, i: uint16|32, pivot: [x, y, z] } }
and `meta`: where the chest's mouth is (the cards come up out of it).

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/daily_drop_models.py -- <out dir>
"""

import base64
import json
import math
import os
import random
import sys

import bmesh
import bpy
import numpy as np
from mathutils import Euler, Matrix, Vector, noise
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.abspath('assets/daily-drop')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rnd = random.Random(11)

# ---- What things are made of: the app shades each its own way ----

K_PLAIN, K_WOOD, K_END, K_GOLD, K_IRON, K_VELVET, K_COIN, K_GEM, K_STONE, K_RUNE, K_GLOW = range(11)


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


OAK = rgb('#8E5C31')
OAK_DARK = rgb('#5A3820')
GOLD = rgb('#E8B64B')
GOLD_DEEP = rgb('#B9822C')
IRON = rgb('#2A2430')
VELVET = rgb('#6A1840')
COIN = rgb('#F4C451')
RUBY = rgb('#E02E66')
AMETHYST = rgb('#8A4DFF')
TOPAZ = rgb('#35D0FF')
STONE = rgb('#2B2442')
STONE_LIGHT = rgb('#3D3460')
RUNE = rgb('#B98CFF')
GLOW = rgb('#FFE7A8')

# ---- The chest's measurements (Blender: x right, y toward the viewer, z up; a metre wide) ----

W = 1.0  # width
D = 0.62  # depth, front to back
H = 0.52  # the body's height: the lid's hinge line
T = 0.05  # plank thickness
R = 0.325  # the lid's radius (a little over half the depth: it overhangs)
HINGE = (0.0, -0.31, H)


def scale_c(c, k):
    return tuple(max(0.0, min(1.0, x * k)) for x in c)


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


# ---- Meshes: built in bmesh round their own origin, bevelled, coloured, then put in place ----


def finish(bm, colour, kind, matrix=None, bevel=0.0, segments=2):
    """The bmesh as a triangulated mesh, bevelled, its colours (a colour or a function of the
    vertex's own, unplaced position), placed by matrix"""
    m = bpy.data.meshes.new('part')
    bm.to_mesh(m)
    bm.free()
    obj = bpy.data.objects.new('part', m)
    scene.collection.objects.link(obj)
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = segments
        mod.limit_method = 'ANGLE'
        mod.angle_limit = math.radians(40)
    tri = obj.modifiers.new('tri', 'TRIANGULATE')
    tri.quad_method = 'BEAUTY'
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    cols = [colour(v.co.copy()) if callable(colour) else colour for v in out.vertices]
    if matrix is not None:
        out.transform(matrix)
    out.update()
    return out, cols, [kind] * len(out.vertices)


def place(at=(0, 0, 0), rot=(0, 0, 0)):
    r = rot if isinstance(rot, Matrix) else Euler(rot).to_matrix()
    return Matrix.Translation(Vector(at)) @ r.to_4x4()


def block(size, colour, kind, at=(0, 0, 0), rot=(0, 0, 0), bevel=0.0, step=None):
    """A box of `size`; `step`: sliced every so far along each axis, for colour to vary across it"""
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    if step:
        for axis in range(3):
            n = max(1, int(round(size[axis] / step)))
            for k in range(1, n):
                co = [0.0, 0.0, 0.0]
                no = [0.0, 0.0, 0.0]
                co[axis] = -size[axis] / 2 + size[axis] * k / n
                no[axis] = 1.0
                bmesh.ops.bisect_plane(bm, geom=bm.verts[:] + bm.edges[:] + bm.faces[:], plane_co=co, plane_no=no)
    return finish(bm, colour, kind, place(at, rot), bevel)


def slab(points, thick, colour, kind, matrix, bevel=0.0):
    """A flat outline (in its own x, y) given a thickness along its z"""
    bm = bmesh.new()
    vs = [bm.verts.new((x, y, -thick / 2)) for x, y in points]
    f = bm.faces.new(vs)
    res = bmesh.ops.extrude_face_region(bm, geom=[f])
    for e in res['geom']:
        if isinstance(e, bmesh.types.BMVert):
            e.co.z = thick / 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    return finish(bm, colour, kind, matrix, bevel)


def cylinder(r, h, colour, kind, matrix, segments=48, bevel=0.0, r2=None):
    """Round its z, centred"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, cap_tris=False, segments=segments, radius1=r,
                          radius2=r if r2 is None else r2, depth=h)
    return finish(bm, colour, kind, matrix, bevel)


def torus(R_, r, colour, kind, matrix, u=40, v=10):
    """A ring in its own xy plane"""
    bm = bmesh.new()
    verts = []
    for i in range(u):
        a = 2 * math.pi * i / u
        for j in range(v):
            b = 2 * math.pi * j / v
            verts.append(bm.verts.new(((R_ + r * math.cos(b)) * math.cos(a), (R_ + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
    for i in range(u):
        for j in range(v):
            a0 = verts[i * v + j]
            a1 = verts[((i + 1) % u) * v + j]
            b1 = verts[((i + 1) % u) * v + (j + 1) % v]
            b0 = verts[i * v + (j + 1) % v]
            bm.faces.new((a0, a1, b1, b0))
    return finish(bm, colour, kind, matrix)


def polar(r_in, r_out, z, colour, kind, rings, segs):
    """A flat ring (or a disc, from r_in 0) facing up, finely divided, so colour and shade can vary
    across it"""
    bm = bmesh.new()
    grid = []
    for i in range(rings + 1):
        r = r_in + (r_out - r_in) * i / rings
        if r == 0:
            grid.append(None)
            continue
        grid.append([bm.verts.new((r * math.cos(2 * math.pi * j / segs), r * math.sin(2 * math.pi * j / segs), z)) for j in range(segs)])
    centre = bm.verts.new((0, 0, z)) if grid[0] is None else None
    for i in range(rings):
        for j in range(segs):
            b0, b1 = grid[i + 1][j], grid[i + 1][(j + 1) % segs]
            if grid[i] is None:
                bm.faces.new((centre, b0, b1))
            else:
                a0, a1 = grid[i][j], grid[i][(j + 1) % segs]
                bm.faces.new((a0, b0, b1, a1))
    return finish(bm, colour, kind)


def wall(r, h, z, colour, kind, segs):
    """The side of a cylinder, open top and bottom, its top at z"""
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=False, segments=segs, radius1=r, radius2=r, depth=h)
    return finish(bm, colour, kind, place((0, 0, z - h / 2)))


def dome(r, colour, kind, matrix, segments=10, rings=6):
    """A rivet head: the top half of a sphere"""
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=segments, v_segments=rings, radius=r)
    bmesh.ops.delete(bm, geom=[v for v in bm.verts if v.co.z < -1e-4], context='VERTS')
    return finish(bm, colour, kind, matrix)


# ---- Colours that vary across a piece ----


def oak(seed, base=OAK):
    """Grain running along x: long streaks warped by noise, a fine fleck, now and then a knot"""
    tint = scale_c(mix(base, OAK_DARK, rnd.uniform(0.0, 0.35)), rnd.uniform(0.92, 1.08))
    knot = Vector((rnd.uniform(-0.4, 0.4), rnd.uniform(-0.02, 0.02), rnd.uniform(-0.02, 0.02)))
    has_knot = rnd.random() < 0.35

    def f(p):
        warp = noise.noise(Vector((p.x * 3.0 + seed, p.y * 14.0, p.z * 14.0 + seed)))
        streak = 0.5 + 0.5 * math.sin((p.y + p.z) * 110.0 + warp * 3.4 + p.x * 1.3 + seed)
        fleck = 0.5 + 0.5 * noise.noise(Vector((p.x * 40.0 + seed, p.y * 70.0, p.z * 70.0)))
        k = 0.78 + 0.16 * streak + 0.08 * fleck
        if has_knot:
            d = math.hypot((p.x - knot.x) * 1.0, (p.y + p.z - knot.y - knot.z) * 3.0)
            if d < 0.05:
                k *= 0.62 + 0.38 * (0.5 + 0.5 * math.sin(d * 260.0))
        return scale_c(tint, k)

    return f


def end_grain(seed):
    """The lid's ends: rings round the middle of the trunk it was cut from"""
    tint = scale_c(OAK_DARK, rnd.uniform(0.95, 1.1))

    def f(p):
        r = math.hypot(p.x - 0.02, p.y + 0.4)
        k = 0.82 + 0.14 * (0.5 + 0.5 * math.sin(r * 160.0 + noise.noise(Vector((p.x * 9, p.y * 9, seed))) * 2.0))
        return scale_c(tint, k)

    return f


def mottled(base, light, freq=6.0):
    def f(p):
        n = 0.5 + 0.5 * noise.noise(Vector((p.x * freq, p.y * freq, p.z * freq)))
        n2 = 0.5 + 0.5 * noise.noise(Vector((p.x * freq * 4, p.y * freq * 4, p.z * freq * 4 + 3)))
        return mix(base, light, n * 0.7 + n2 * 0.3)

    return f


# ---- The body ----

print('body')
body = []
rows = 3
row_h = (H - 0.07) / rows
for i in range(rows):
    zc = 0.07 + row_h * (i + 0.5)
    for side in (1, -1):
        # Front and back: long planks across
        body.append(block((W, T, row_h - 0.007), oak(rnd.uniform(0, 50)), K_WOOD,
                          at=(rnd.uniform(-0.003, 0.003), side * (D / 2 - T / 2 + rnd.uniform(-0.002, 0.002)), zc),
                          rot=(0, math.radians(rnd.uniform(-0.5, 0.5)), 0), bevel=0.006, step=0.025))
        # The ends: shorter planks, the grain running front to back
        body.append(block((D - 2 * T, T, row_h - 0.007), oak(rnd.uniform(0, 50)), K_WOOD,
                          at=(side * (W / 2 - T / 2 + rnd.uniform(-0.002, 0.002)), 0, zc),
                          rot=(0, math.radians(rnd.uniform(-0.5, 0.5)), math.pi / 2), bevel=0.006, step=0.025))
# A dark skirt round the foot
body.append(block((W + 0.04, D + 0.04, 0.075), oak(rnd.uniform(0, 50), OAK_DARK), K_WOOD, at=(0, 0, 0.0375), bevel=0.01, step=0.03))
# The velvet lining, just inside the walls
lining_h = H - 0.11
for side in (1, -1):
    body.append(block((W - 2 * T, 0.01, lining_h), VELVET, K_VELVET, at=(0, side * (D / 2 - T - 0.005), H - 0.01 - lining_h / 2)))
    body.append(block((0.01, D - 2 * T, lining_h), VELVET, K_VELVET, at=(side * (W / 2 - T - 0.005), 0, H - 0.01 - lining_h / 2)))
# The gilded bands round the top edge and the foot
for zc, hh in ((H - 0.025, 0.05), (0.1, 0.04)):
    for side in (1, -1):
        body.append(block((W + 0.026, 0.013, hh), GOLD, K_GOLD, at=(0, side * (D / 2 + 0.0065), zc), bevel=0.004))
        body.append(block((0.013, D + 0.026, hh), GOLD, K_GOLD, at=(side * (W / 2 + 0.0065), 0, zc), bevel=0.004))
# The light that leaks out round the lid when it strains: a strip just under the rim, inside
for side in (1, -1):
    body.append(block((W - 2 * T, 0.006, 0.012), GLOW, K_GLOW, at=(0, side * (D / 2 - T - 0.012), H - 0.004)))
    body.append(block((0.006, D - 2 * T, 0.012), GLOW, K_GLOW, at=(side * (W / 2 - T - 0.012), 0, H - 0.004)))
# Straps up the front and back, and the rivets that hold them
for side in (1, -1):
    for x in (-0.27, 0.27):
        body.append(block((0.075, 0.013, H - 0.02), GOLD, K_GOLD, at=(x, side * (D / 2 + 0.0065), H / 2), bevel=0.004))
        for z in (0.16, 0.27, 0.38):
            body.append(dome(0.011, GOLD_DEEP, K_GOLD, place((x, side * (D / 2 + 0.013), z), (-side * math.pi / 2, 0, 0))))
# Corner caps, an L of gilded plate down each upright edge
for sx in (1, -1):
    for sy in (1, -1):
        body.append(block((0.1, 0.013, H), GOLD, K_GOLD, at=(sx * (W / 2 - 0.05), sy * (D / 2 + 0.0065), H / 2), bevel=0.004))
        body.append(block((0.013, 0.1, H), GOLD, K_GOLD, at=(sx * (W / 2 + 0.0065), sy * (D / 2 - 0.05), H / 2), bevel=0.004))
        for z in (0.17, 0.36):
            body.append(dome(0.01, GOLD_DEEP, K_GOLD, place((sx * (W / 2 - 0.05), sy * (D / 2 + 0.013), z), (-sy * math.pi / 2, 0, 0))))
            body.append(dome(0.01, GOLD_DEEP, K_GOLD, place((sx * (W / 2 + 0.013), sy * (D / 2 - 0.05), z), (0, sx * math.pi / 2, 0))))
# The lock plate, a shield, and its keyhole
SHIELD = [(-0.085, 0.07), (-0.085, -0.03), (-0.05, -0.085), (0.0, -0.11), (0.05, -0.085), (0.085, -0.03),
          (0.085, 0.07), (0.05, 0.1), (0.0, 0.11), (-0.05, 0.1)]
upright = Euler((math.pi / 2, 0, 0)).to_matrix()
body.append(slab(SHIELD, 0.016, GOLD, K_GOLD, place((0, D / 2 + 0.016, 0.395), upright), bevel=0.005))
hole = [(0.018 * math.cos(a), 0.012 + 0.018 * math.sin(a)) for a in [2 * math.pi * k / 18 for k in range(18)]]
body.append(slab(hole, 0.006, IRON, K_IRON, place((0, D / 2 + 0.025, 0.395), upright)))
body.append(slab([(-0.008, 0.0), (-0.015, -0.05), (0.015, -0.05), (0.008, 0.0)], 0.006, IRON, K_IRON,
                 place((0, D / 2 + 0.025, 0.395), upright)))
for x, z in ((-0.06, 0.45), (0.06, 0.45), (-0.06, 0.34), (0.06, 0.34)):
    body.append(dome(0.008, GOLD_DEEP, K_GOLD, place((x, D / 2 + 0.024, z), (-math.pi / 2, 0, 0))))
# Ring handles at the ends, each on a plate
for sx in (1, -1):
    body.append(block((0.013, 0.13, 0.07), GOLD, K_GOLD, at=(sx * (W / 2 + 0.013), 0, 0.37), bevel=0.004))
    body.append(torus(0.06, 0.012, GOLD, K_GOLD, place((sx * (W / 2 + 0.03), 0, 0.31), (0, math.pi / 2, 0)), u=36, v=8))

# ---- The lid, round its hinge at the back of the top ----

print('lid')
lid = []
cyc = Matrix(((0, 0, 1), (1, 0, 0), (0, 1, 0)))  # an outline's x, y onto the world's y, z; its z onto x
STAVES = 7
for i in range(STAVES):
    th = (i + 0.5) * math.pi / STAVES
    rc = R - 0.0225
    lid.append(block((0.9, R * math.pi / STAVES - 0.006, 0.045), oak(rnd.uniform(0, 50)), K_WOOD,
                     at=(rnd.uniform(-0.002, 0.002), rc * math.cos(th), H + rc * math.sin(th)),
                     rot=(th - math.pi / 2, 0, 0), bevel=0.006, step=0.025))
half = [(R * math.cos(a), R * math.sin(a)) for a in [math.pi * k / 24 for k in range(25)]]
for sx in (1, -1):
    lid.append(slab(half, 0.05, end_grain(rnd.uniform(0, 9)), K_END, place((sx * 0.475, 0, H), cyc), bevel=0.006))


def arch(r_out, r_in, n=32):
    out = [(r_out * math.cos(a), r_out * math.sin(a)) for a in [math.pi * k / n for k in range(n + 1)]]
    inn = [(r_in * math.cos(a), r_in * math.sin(a)) for a in [math.pi * k / n for k in range(n, -1, -1)]]
    return out + inn


# Gilded edging round each end, and the two straps over the top
for sx in (1, -1):
    lid.append(slab(arch(R + 0.008, R - 0.03), 0.014, GOLD, K_GOLD, place((sx * 0.506, 0, H), cyc), bevel=0.003))
    lid.append(slab(arch(R + 0.013, R - 0.004), 0.075, GOLD, K_GOLD, place((sx * 0.27, 0, H), cyc), bevel=0.004))
    for a in (0.35, 0.95, 1.57, 2.19, 2.79):
        rr = R + 0.016
        lid.append(dome(0.011, GOLD_DEEP, K_GOLD, place((sx * 0.27, rr * math.cos(a), H + rr * math.sin(a)), (a - math.pi / 2, 0, 0))))
# Bands along its front and back edges
for sy in (1, -1):
    lid.append(block((W + 0.03, 0.014, 0.05), GOLD, K_GOLD, at=(0, sy * (R + 0.004), H + 0.025), bevel=0.004))
# Velvet inside it, seen when it's open
lid.append(slab(arch(R - 0.046, R - 0.054), 0.9, VELVET, K_VELVET, place((0, 0, H), cyc)))
# The hasp, hanging down over the lock plate, and its loop
lid.append(slab([(-0.035, 0.06), (-0.035, -0.04), (0.0, -0.07), (0.035, -0.04), (0.035, 0.06)], 0.012, GOLD, K_GOLD,
                place((0, R + 0.017, H - 0.005), upright), bevel=0.004))
lid.append(torus(0.02, 0.006, GOLD_DEEP, K_GOLD, place((0, R + 0.026, H - 0.058), (math.pi / 2, 0, 0)), u=20, v=6))
# A ruby set in a gold bezel, high on the front of the lid
th = math.radians(62)
out = Vector((0, math.cos(th), math.sin(th)))
seat = Vector((0, 0, H)) + out * (R + 0.004)
tilt = Euler((th - math.pi / 2, 0, 0)).to_matrix()
lid.append(cylinder(0.062, 0.012, GOLD, K_GOLD, place(seat, tilt), segments=40, bevel=0.003))
lid.append(torus(0.047, 0.009, GOLD_DEEP, K_GOLD, place(seat + out * 0.008, tilt), u=36, v=8))
lid.append(cylinder(0.042, 0.022, RUBY, K_GEM, place(seat + out * 0.017, tilt), segments=8, r2=0.026))
lid.append(cylinder(0.042, 0.03, RUBY, K_GEM, place(seat + out * -0.006, tilt @ Euler((math.pi, 0, 0)).to_matrix()), segments=8, r2=0.0))

# ---- What's inside: a heap of coins and a few gems on velvet ----

print('treasure')
treasure = [block((W - 2 * T - 0.02, D - 2 * T - 0.02, 0.02), VELVET, K_VELVET, at=(0, 0, 0.3))]
placed = 0
while placed < 170:
    x = rnd.uniform(-0.44, 0.44)
    y = rnd.uniform(-0.25, 0.25)
    e = 1 - (x / 0.47) ** 2 - (y / 0.29) ** 2
    if e <= 0:
        continue
    z = 0.33 + 0.15 * e ** 0.7 + rnd.uniform(-0.01, 0.01)
    rot = Euler((rnd.uniform(-0.6, 0.6), rnd.uniform(-0.6, 0.6), rnd.uniform(0, math.pi * 2))).to_matrix()
    treasure.append(cylinder(rnd.uniform(0.042, 0.05), 0.01, scale_c(COIN, rnd.uniform(0.86, 1.06)), K_COIN,
                             place((x, y, z), rot), segments=16))
    placed += 1
for k in range(9):
    x = rnd.uniform(-0.34, 0.34)
    y = rnd.uniform(-0.18, 0.18)
    e = 1 - (x / 0.47) ** 2 - (y / 0.29) ** 2
    z = 0.34 + 0.15 * max(0.0, e) ** 0.7 + 0.02
    rot = Euler((rnd.uniform(-0.5, 0.5), rnd.uniform(-0.5, 0.5), rnd.uniform(0, 6.28))).to_matrix()
    c = (RUBY, AMETHYST, TOPAZ)[k % 3]
    treasure.append(cylinder(0.04, 0.02, c, K_GEM, place((x, y, z + 0.01), rot), segments=8, r2=0.025))
    treasure.append(cylinder(0.04, 0.04, c, K_GEM, place((x, y, z - 0.02), rot @ Euler((math.pi, 0, 0)).to_matrix()), segments=8, r2=0.0))

# ---- The dais ----

print('dais')
dais = [
    polar(0.0, 0.95, 0.0, mottled(STONE, STONE_LIGHT), K_STONE, 32, 96),
    wall(0.95, 0.12, 0.0, mottled(STONE, STONE_LIGHT), K_STONE, 96),
    polar(0.95, 1.1, -0.12, mottled(scale_c(STONE, 0.8), STONE), K_STONE, 5, 96),
    wall(1.1, 0.08, -0.12, mottled(scale_c(STONE, 0.8), STONE), K_STONE, 96),
    torus(0.95, 0.013, GOLD, K_GOLD, place((0, 0, -0.004)), u=128, v=8),
    torus(1.1, 0.012, GOLD_DEEP, K_GOLD, place((0, 0, -0.122)), u=128, v=8),
]
# Runes cut round the top: each a few strokes, glowing
GLYPHS = 22
for g in range(GLYPHS):
    a = 2 * math.pi * g / GLYPHS
    centre = Vector((0.8 * math.cos(a), 0.8 * math.sin(a), 0.0015))
    face = Euler((0, 0, a + math.pi / 2)).to_matrix()
    for s in range(rnd.randint(2, 4)):
        long = rnd.random() < 0.5
        size = (0.012, rnd.uniform(0.05, 0.08), 0.003) if long else (rnd.uniform(0.03, 0.05), 0.012, 0.003)
        off = Vector((rnd.uniform(-0.02, 0.02), rnd.uniform(-0.025, 0.025), 0))
        dais.append(block(size, RUNE, K_RUNE, at=centre + face @ off, rot=face @ Euler((0, 0, rnd.choice((0, 0.6, -0.6)))).to_matrix()))

# ---- The loose ones that fly out ----

print('coin, gem')
STAR = [((0.032 if k % 2 == 0 else 0.014) * math.cos(math.pi / 2 + k * math.pi / 5),
         (0.032 if k % 2 == 0 else 0.014) * math.sin(math.pi / 2 + k * math.pi / 5)) for k in range(10)]
coin = [
    cylinder(0.06, 0.012, COIN, K_COIN, place(), segments=40, bevel=0.003),
    torus(0.055, 0.0045, scale_c(COIN, 0.92), K_COIN, place((0, 0, 0.006)), u=40, v=6),
    torus(0.055, 0.0045, scale_c(COIN, 0.92), K_COIN, place((0, 0, -0.006)), u=40, v=6),
    slab(STAR, 0.003, scale_c(COIN, 1.04), K_COIN, place((0, 0, 0.0065)), bevel=0.001),
    slab(STAR, 0.003, scale_c(COIN, 1.04), K_COIN, place((0, 0, -0.0065)), bevel=0.001),
]
gem = [
    cylinder(0.05, 0.022, AMETHYST, K_GEM, place((0, 0, 0.011)), segments=8, r2=0.032),
    cylinder(0.05, 0.055, AMETHYST, K_GEM, place((0, 0, -0.0275), Euler((math.pi, 0, 0))), segments=8, r2=0.0),
]

# ---- The key that opens the padlock ----
# Its bow round a glass bulb (the hold fills it with light), a collar, the shaft, the bit. The bow's
# middle is its origin; the shaft runs back from it (three's -z, into the lock), the bit hangs down.
# The bow faces along the shaft, a medallion: in the lock, it faces us, and we see it turn.

K_BULB, K_EGG = 14, 15
AMBER = rgb('#FF9A1F')


def tube(points, radius, colour, kind, seg=10):
    """A round tube along points, its ends capped"""
    bm = bmesh.new()
    rings = []
    for i, p in enumerate(points):
        t = (points[min(i + 1, len(points) - 1)] - points[max(i - 1, 0)]).normalized()
        a = t.orthogonal().normalized()
        b = t.cross(a)
        rings.append([bm.verts.new(p + (a * math.cos(2 * math.pi * j / seg) + b * math.sin(2 * math.pi * j / seg)) * radius)
                      for j in range(seg)])
    for r0, r1 in zip(rings, rings[1:]):
        for j in range(seg):
            bm.faces.new((r0[j], r0[(j + 1) % seg], r1[(j + 1) % seg], r1[j]))
    bm.faces.new(list(reversed(rings[0])))
    bm.faces.new(rings[-1])
    return finish(bm, colour, kind)


def ball(r, colour, kind, matrix, u=24, v=16):
    bm = bmesh.new()
    bmesh.ops.create_uvsphere(bm, u_segments=u, v_segments=v, radius=r)
    return finish(bm, colour, kind, matrix)


print('key')
round_shaft = (math.pi / 2, 0, 0)  # a ring round the shaft (the bow's too), or a cylinder along it
key = [
    ball(0.026, rgb('#FFF4DA'), K_BULB, place()),
    torus(0.036, 0.0065, GOLD, K_GOLD, place(rot=round_shaft), u=48, v=10),
    torus(0.031, 0.0028, GOLD_DEEP, K_GOLD, place(rot=round_shaft), u=48, v=6),
    ball(0.0075, GOLD, K_GOLD, place((0, 0, 0.047)), u=14, v=10),
    torus(0.010, 0.0035, GOLD, K_GOLD, place((0, -0.04, 0), round_shaft), u=20, v=8),
    ball(0.0085, GOLD, K_GOLD, place((0, -0.049, 0)), u=14, v=10),
    cylinder(0.0072, 0.13, GOLD, K_GOLD, place((0, -0.11, 0), round_shaft), segments=20),
    torus(0.0088, 0.0026, GOLD_DEEP, K_GOLD, place((0, -0.078, 0), round_shaft), u=20, v=6),
    torus(0.0088, 0.0026, GOLD_DEEP, K_GOLD, place((0, -0.138, 0), round_shaft), u=20, v=6),
    # The bit: a plate under the end of the shaft, two teeth cut into it
    block((0.0055, 0.03, 0.018), GOLD, K_GOLD, at=(0, -0.157, -0.013), bevel=0.0012),
    block((0.0055, 0.008, 0.01), GOLD, K_GOLD, at=(0, -0.166, -0.027), bevel=0.001),
    block((0.0055, 0.008, 0.006), GOLD, K_GOLD, at=(0, -0.15, -0.025), bevel=0.001),
]
# Four small loops round the bow, a ruby in each
for a in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4):
    at = (0.043 * math.cos(a), 0, 0.043 * math.sin(a))
    key.append(torus(0.011, 0.0035, GOLD, K_GOLD, place(at, round_shaft), u=20, v=6))
    key.append(ball(0.0055, RUBY, K_GEM, place(at), u=10, v=8))

# ---- The legendary egg: Ember Fox's, in a gold cage ----
# A dark, glossy shell (the app cracks it with light), four gold bands up it from a ring at the
# bottom to a crown at the top, a band round its widest, an amber gem on it in front and to each
# side and behind. Its middle is its origin, upright.

print('egg')
EGG_R = 0.18


def egg_r(th):
    """Its radius at angle th from the bottom (an egg: rounder below, narrower at the top)"""
    return EGG_R * math.sin(th) * (1 + 0.18 * math.cos(th)) * 0.72


def egg_at(th, az, out=0.0):
    """A point on its shell (or `out` beyond it, away from its middle), th from the bottom, az round
    from the front"""
    r = egg_r(th)
    p = Vector((r * math.sin(az), r * math.cos(az), -EGG_R * math.cos(th)))
    return p + p.normalized() * out if out else p


bm = bmesh.new()
RINGS, SEGS = 48, 64
rows = []
for i in range(1, RINGS):
    th = math.pi * i / RINGS
    rows.append([bm.verts.new(egg_at(th, 2 * math.pi * j / SEGS)) for j in range(SEGS)])
bottom = bm.verts.new((0, 0, -EGG_R))
top = bm.verts.new((0, 0, EGG_R))
for j in range(SEGS):
    bm.faces.new((bottom, rows[0][(j + 1) % SEGS], rows[0][j]))
    bm.faces.new((top, rows[-1][j], rows[-1][(j + 1) % SEGS]))
for r0, r1 in zip(rows, rows[1:]):
    for j in range(SEGS):
        bm.faces.new((r0[j], r0[(j + 1) % SEGS], r1[(j + 1) % SEGS], r1[j]))
egg = [finish(bm, mottled(rgb('#2A0C14'), rgb('#4C1622'), 9.0), K_EGG)]
widest = max((math.pi * k / 200 for k in range(1, 200)), key=egg_r)
for az in (math.pi / 4, 3 * math.pi / 4, 5 * math.pi / 4, 7 * math.pi / 4):
    egg.append(tube([egg_at(0.32 + (math.pi - 0.62) * k / 40, az, 0.006) for k in range(41)], 0.0065, GOLD, K_GOLD, seg=8))
for th, w in ((0.32, 0.008), (math.pi - 0.3, 0.007), (widest, 0.009)):
    at = egg_at(th, 0, 0.006)
    egg.append(torus(at.y, w, GOLD if th == widest else GOLD_DEEP, K_GOLD, place((0, 0, at.z)), u=96, v=8))
for az in (0, math.pi / 2, math.pi, 3 * math.pi / 2):
    at = egg_at(widest, az, 0.014)
    out = Vector((math.sin(az), math.cos(az), 0))
    face = out.to_track_quat('Z', 'Y').to_matrix()
    egg.append(cylinder(0.017, 0.006, GOLD, K_GOLD, place(at - out * 0.004, face), segments=24))
    egg.append(cylinder(0.014, 0.008, AMBER, K_GEM, place(at + out * 0.003, face), segments=8, r2=0.009))
# The crown on top: a ring of points round a gold bead, an amber gem set in it
crown_z = EGG_R - 0.004
for k in range(8):
    a = 2 * math.pi * k / 8
    base = Vector((0.026 * math.sin(a), 0.026 * math.cos(a), crown_z - 0.012))
    tip = Vector((0.03 * math.sin(a), 0.03 * math.cos(a), crown_z + 0.03 + (0.008 if k % 2 == 0 else 0.0)))
    egg.append(cylinder(0.006, (tip - base).length, GOLD, K_GOLD,
                        place((base + tip) / 2, (tip - base).to_track_quat('Z', 'Y').to_matrix()), segments=8, r2=0.0015))
egg.append(torus(0.026, 0.005, GOLD, K_GOLD, place((0, 0, crown_z - 0.012)), u=40, v=8))
egg.append(ball(0.012, AMBER, K_GEM, place((0, 0, crown_z + 0.012)), u=16, v=12))

# ---- Shade, pack, write ----


def ambient(groups, rays=32, reach=0.12, strength=0.58):
    """How much of the sky over each vertex the model itself hides, worked into its colour.
    `groups`: [(pieces, shade)]; pieces with `shade` false only hide the sky from the others"""
    verts, tris = [], []
    for pieces, _ in groups:
        for m, _c, _k in pieces:
            base = len(verts)
            verts.extend([v.co.copy() for v in m.vertices])
            m.calc_loop_triangles()
            tris.extend([[base + i for i in t.vertices] for t in m.loop_triangles])
    tree = BVHTree.FromPolygons(verts, tris)
    golden = math.pi * (3 - math.sqrt(5))
    dirs = []
    for k in range(rays):
        z = math.sqrt(1 - (k + 0.5) / rays)
        r = math.sqrt(max(0.0, 1 - z * z))
        dirs.append((r * math.cos(k * golden), r * math.sin(k * golden), z))
    for pieces, shade in groups:
        if not shade:
            continue
        for m, cols, _k in pieces:
            for i, v in enumerate(m.vertices):
                n = v.normal
                if n.length < 0.5:
                    continue
                t = n.orthogonal().normalized()
                b = n.cross(t)
                p = v.co + n * 0.003
                hit = 0.0
                for dx, dy, dz in dirs:
                    d = t * dx + b * dy + n * dz
                    loc, hn, _i, dist = tree.ray_cast(p, d, reach)
                    if loc is not None and hn.dot(d) < 0:
                        hit += 1 - 0.5 * dist / reach
                f = 1 - strength * hit / rays
                cols[i] = tuple(x * f for x in cols[i])


def pack(pieces, pivot=(0, 0, 0), sharp=math.radians(50)):
    """Join pieces into one indexed buffer in three.js axes, relative to pivot"""
    P, N, C, K, I = [], [], [], [], []
    piv = Vector(pivot)
    for m, colours, kinds in pieces:
        m.calc_loop_triangles()
        for p in m.polygons:
            p.use_smooth = True
        m.set_sharp_from_angle(angle=sharp)
        normals = m.corner_normals
        index = {}
        for tri in m.loop_triangles:
            for k in range(3):
                loop = tri.loops[k]
                vi = m.loops[loop].vertex_index
                n = normals[loop].vector
                key = (vi, round(n.x, 2), round(n.y, 2), round(n.z, 2))
                if key not in index:
                    co = m.vertices[vi].co - piv
                    index[key] = len(P) // 3
                    # Blender (x right, y toward the viewer, z up) to three (y up, facing +z)
                    P.extend((-co.x, co.z, co.y))
                    N.extend((-n.x, n.z, n.y))
                    C.extend(colours[vi])
                    K.append(kinds[vi])
                I.append(index[key])
    p = np.array(P, np.float32)
    n = np.clip(np.round(np.array(N) * 127), -127, 127).astype(np.int8)
    c = np.clip(np.round(np.array(C) * 255), 0, 255).astype(np.uint8)
    k = np.array(K, np.uint8)
    i = np.array(I, np.uint16 if len(P) // 3 < 65535 else np.uint32)
    enc = lambda a: base64.b64encode(a.tobytes()).decode()  # noqa: E731
    print('  ', len(P) // 3, 'verts', len(I) // 3, 'tris')
    return {'p': enc(p), 'n': enc(n), 'c': enc(c), 'k': enc(k), 'i': enc(i),
            'pivot': [round(-piv.x, 4), round(piv.z, 4), round(piv.y, 4)]}


print('ambient occlusion')
ambient([(body, True), (treasure, False), (dais, False)])
ambient([(lid, True)])
ambient([(treasure, True), (body, False)])
ambient([(dais, True), (body, False)], reach=0.3, strength=0.75)
ambient([(coin, True)], reach=0.02, strength=0.3)
ambient([(key, True)], reach=0.015, strength=0.35)
ambient([(egg, True)], reach=0.04, strength=0.55)

print('pack')
models = {
    'body': pack(body),
    'lid': pack(lid, HINGE),
    'treasure': pack(treasure),
    'dais': pack(dais),
    'coin': pack(coin),
    'gem': pack(gem, sharp=math.radians(12)),
    'key': pack(key),
    'egg': pack(egg),
    # In three's axes: the middle of the chest's open top, and the lid's hinge
    'meta': {'mouth': [0.0, H + 0.05, 0.0], 'hinge': [0.0, HINGE[2], HINGE[1]], 'height': H + R},
}
path = os.path.join(OUT, 'models.json')
with open(path, 'w') as f:
    json.dump(models, f, separators=(',', ':'))
print('wrote', path, os.path.getsize(path) // 1024, 'KB')
