"""
Models the Fairy Globe's sleigh team out of metaballs and curves, toy-soft like clay, down to the
small things that make them read up close: Santa with his spectacles, a curled moustache and a
beard in curls, fur trims that are fluffy, a belt buckle with its prong, a throwing arm of its own;
reindeer with a pale mane under the neck, cloven hooves and dewclaws, a burr at the root of each
antler, a breast strap, tassels on the saddle cloth, bells with their slots; the sleigh with gold
scrolls.

Every vertex carries its colour, with ambient occlusion worked in (rays cast against the whole
model in place, so the beard shades the chest under it and the saddle cloth's edge the flank), and
what it's made of: fur, fluff, felt, skin, leather, metal, gloss, wood or bone. The app gives each
its own surface (sleigh.ts): strands in fur, a shine on brass, a glint in an eye.

Writes assets/fairy-globe/models.json: for each part, indexed triangles with smooth normals, a
colour and a material per vertex, in three.js axes (y up, facing +z), base64 encoded:
  { name: { p: float32 xyz, n: int8 xyz, c: uint8 rgb, k: uint8, i: uint16|32, pivot: [x, y, z] } }

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/fairy_globe_models.py -- <out dir>
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
from mathutils import Matrix, Quaternion, Vector, noise
from mathutils.bvhtree import BVHTree

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.abspath('assets/fairy-globe')
os.makedirs(OUT, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
scene = bpy.context.scene
rnd = random.Random(5)

# ---- What things are made of: the app shades each its own way ----

K_PLAIN, K_FUR, K_FLUFF, K_FELT, K_SKIN, K_LEATHER, K_METAL, K_GLOSS, K_WOOD, K_BONE = range(10)
KIND_OF = {}


def rgb(h):
    h = h.lstrip('#')
    return tuple(int(h[i:i + 2], 16) / 255 for i in (0, 2, 4))


def colour(h, kind):
    c = rgb(h)
    KIND_OF[c] = kind
    return c


# Reindeer
FUR = colour('#8A5636', K_FUR)
FUR_DARK = colour('#5E3722', K_FUR)
FUR_LEG = colour('#6B4027', K_FUR)
MUZZLE = colour('#A9764F', K_FUR)
CREAM = colour('#EAD6B4', K_FLUFF)
RUMP = colour('#F1E6D2', K_FLUFF)
SOCK = colour('#E6D6BC', K_FLUFF)
HOOF = colour('#3A2418', K_LEATHER)
ANTLER = colour('#EBD6AC', K_BONE)
ANTLER_BASE = colour('#A68763', K_BONE)
NOSE = colour('#2A1B16', K_GLOSS)
EYE = colour('#1C1416', K_GLOSS)
GLINT = colour('#FFFFFF', K_GLOSS)
EAR_IN = colour('#D9A58C', K_SKIN)
STRAP = colour('#A51C2A', K_LEATHER)
CLOTH = colour('#C42335', K_FELT)
GOLD = colour('#E9B949', K_METAL)
# Santa
RED = colour('#C8243A', K_FELT)
WHITE = colour('#FBF7F0', K_FLUFF)
SKIN = colour('#F2B99A', K_SKIN)
CHEEK = colour('#EE8F86', K_SKIN)
NOSE_SKIN = colour('#EE9D88', K_SKIN)
GLOVE = colour('#3A2920', K_LEATHER)
BOOT = colour('#1E1716', K_LEATHER)
BELT = colour('#241A18', K_LEATHER)
SOLE = colour('#141010', K_LEATHER)
# The sleigh and the sack
SLEIGH_RED = colour('#C21F35', K_WOOD)
RED_DARK = colour('#8E1427', K_WOOD)
VELVET = colour('#1F7A4C', K_FELT)
SACK = colour('#A8643E', K_FELT)
ROPE = colour('#D8B26A', K_FELT)
RIBBON = colour('#FBF7F1', K_FELT)


def kinds_of(cols):
    return [KIND_OF.get(c, K_PLAIN) for c in cols]


def mix(a, b, t):
    return tuple(x + (y - x) * t for x, y in zip(a, b))


def smooth(e0, e1, x):
    t = max(0.0, min(1.0, (x - e0) / (e1 - e0)))
    return t * t * (3 - 2 * t)


# ---- Metaballs, coloured by whichever element a vertex belongs to most ----


class Blob:
    """
    A metaball: its surface comes in at about two thirds of each element's radius; `grow` scales
    every element so the radii given are the surface's
    """

    def __init__(self, name, resolution=0.022, grow=1.0):
        self.grow = grow
        self.data = bpy.data.metaballs.new(name)
        self.data.resolution = resolution
        self.data.render_resolution = resolution
        self.data.threshold = 0.6
        self.obj = bpy.data.objects.new(name, self.data)
        scene.collection.objects.link(self.obj)
        self.parts = []  # (kind, a, b, size, colour)

    def ball(self, at, r, colour, stiffness=2.0):
        r *= self.grow
        e = self.data.elements.new(type='BALL')
        e.co = at
        e.radius = r
        e.stiffness = stiffness
        self.parts.append(('ball', Vector(at), None, Vector((r, r, r)), colour))

    def ellipsoid(self, at, size, colour, rot=None, stiffness=2.0):
        size = tuple(x * self.grow for x in size)
        e = self.data.elements.new(type='ELLIPSOID')
        e.co = at
        e.radius = 1.0
        e.size_x, e.size_y, e.size_z = size
        e.stiffness = stiffness
        if rot is not None:
            e.rotation = rot
        self.parts.append(('ellipsoid', Vector(at), rot, Vector(size), colour))

    def capsule(self, a, b, r, colour, stiffness=2.0):
        r *= self.grow
        a, b = Vector(a), Vector(b)
        e = self.data.elements.new(type='CAPSULE')
        e.co = (a + b) / 2
        e.radius = r
        e.size_x = (b - a).length / 2
        e.rotation = Vector((1, 0, 0)).rotation_difference((b - a).normalized())
        e.stiffness = stiffness
        self.parts.append(('capsule', a, b, Vector((r, r, r)), colour))

    def closeness(self, p):
        """How deep inside each element p sits: smaller is closer"""
        out = []
        for kind, a, b, size, colour in self.parts:
            if kind == 'ball':
                d = (p - a).length / size.x
            elif kind == 'ellipsoid':
                q = p - a
                if b is not None:
                    q = b.inverted() @ q
                d = Vector((q.x / (size.x + 1e-6), q.y / (size.y + 1e-6), q.z / (size.z + 1e-6))).length
            else:
                ab = b - a
                t = max(0, min(1, (p - a).dot(ab) / ab.length_squared))
                d = (p - (a + ab * t)).length / size.x
            out.append((d, colour))
        return out

    def mesh(self):
        dg = bpy.context.evaluated_depsgraph_get()
        m = bpy.data.meshes.new_from_object(self.obj.evaluated_get(dg))
        colours = []
        for v in m.vertices:
            near = min(self.closeness(v.co), key=lambda t: t[0])
            colours.append(near[1])
        bpy.data.objects.remove(self.obj)
        return m, colours


def ring(blob, centre, axis, radius, count, r, colour, jitter=0.0, phase=0.0):
    """Balls in a ring round an axis: a fluffy band of fur"""
    axis = Vector(axis).normalized()
    t = axis.orthogonal().normalized()
    b = axis.cross(t)
    for k in range(count):
        a = phase + 2 * math.pi * k / count
        p = Vector(centre) + (t * math.cos(a) + b * math.sin(a)) * radius
        if jitter:
            p += Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))) * jitter
        blob.ball(tuple(p), r * rnd.uniform(0.85, 1.15) if jitter else r, colour)


def fluffy(p, amp, freq, seed=0.0, only=None):
    """
    Push each vertex out or in along its normal by noise, three octaves: cotton, fur, curls.
    `only`: just the vertices of these colours
    """
    m, cols, _k = p
    off = Vector((seed * 3.1, seed * 1.7, seed * 2.3))
    for i, v in enumerate(m.vertices):
        if only is not None and cols[i] not in only:
            continue
        q = v.co * freq + off
        d = noise.noise(q) + 0.5 * noise.noise(q * 2.1) + 0.25 * noise.noise(q * 4.3)
        # Lumps stand out more than they dip: fluff
        v.co += v.normal * (amp * (0.35 + d))
    m.update()
    return p


def loop(centre, axis, radius, n=48, squash=(1.0, 1.0), lift=None):
    """Points round a closed ring (one past the start, so a tube through them closes)"""
    axis = Vector(axis).normalized()
    t = axis.orthogonal().normalized()
    b = axis.cross(t)
    pts = []
    for k in range(n + 2):
        a = 2 * math.pi * k / n
        p = Vector(centre) + t * math.cos(a) * radius * squash[0] + b * math.sin(a) * radius * squash[1]
        if lift:
            p.z += lift(a)
        pts.append(tuple(p))
    return pts


def tube(name, points, radius, colour, taper=None, res=3):
    """A curve with a round bevel along points"""
    cu = bpy.data.curves.new(name, 'CURVE')
    cu.dimensions = '3D'
    cu.bevel_depth = radius
    cu.bevel_resolution = res
    cu.use_fill_caps = True
    sp = cu.splines.new('POLY')
    sp.points.add(len(points) - 1)
    for i, p in enumerate(points):
        sp.points[i].co = (*p, 1)
        if taper:
            sp.points[i].radius = taper[i]
    sp.use_smooth = True
    obj = bpy.data.objects.new(name, cu)
    scene.collection.objects.link(obj)
    dg = bpy.context.evaluated_depsgraph_get()
    m = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    return m, [colour] * len(m.vertices)


def smooth_tube(name, points, radius, colour, taper=None, steps=6, res=3):
    """tube() through a Catmull-Rom spline of points"""
    pts = [Vector(p) for p in points]
    out, rad = [], []
    for i in range(len(pts) - 1):
        p0 = pts[max(0, i - 1)]
        p1, p2 = pts[i], pts[i + 1]
        p3 = pts[min(len(pts) - 1, i + 2)]
        for s in range(steps):
            t = s / steps
            t2, t3 = t * t, t * t * t
            q = 0.5 * ((2 * p1) + (-p0 + p2) * t + (2 * p0 - 5 * p1 + 4 * p2 - p3) * t2 + (-p0 + 3 * p1 - 3 * p2 + p3) * t3)
            out.append(tuple(q))
            if taper:
                rad.append(taper[i] + (taper[i + 1] - taper[i]) * t)
    out.append(tuple(pts[-1]))
    if taper:
        rad.append(taper[-1])
    return tube(name, out, radius, colour, rad if taper else None, res=res)


def prim(kind, colour, at=(0, 0, 0), scale=(1, 1, 1), rot=(0, 0, 0), bevel=0.0, **kw):
    bm = bmesh.new()
    if kind == 'cube':
        bmesh.ops.create_cube(bm, size=1)
    elif kind == 'cone':
        bmesh.ops.create_cone(bm, cap_ends=True, segments=kw.get('segments', 24), radius1=kw.get('r1', 0.5),
                              radius2=kw.get('r2', 0.0), depth=kw.get('depth', 1))
    elif kind == 'sphere':
        bmesh.ops.create_uvsphere(bm, u_segments=kw.get('segments', 20), v_segments=kw.get('rings', 12), radius=0.5)
    elif kind == 'torus':
        # A ring in the XY plane
        R, r, u, v = kw['R'], kw['r'], kw.get('u', 28), kw.get('v', 10)
        verts = []
        for i in range(u):
            a = 2 * math.pi * i / u
            for j in range(v):
                b = 2 * math.pi * j / v
                verts.append(bm.verts.new(((R + r * math.cos(b)) * math.cos(a), (R + r * math.cos(b)) * math.sin(a), r * math.sin(b))))
        for i in range(u):
            for j in range(v):
                a0 = verts[i * v + j]
                a1 = verts[((i + 1) % u) * v + j]
                b1 = verts[((i + 1) % u) * v + (j + 1) % v]
                b0 = verts[i * v + (j + 1) % v]
                bm.faces.new((a0, a1, b1, b0))
    m = bpy.data.meshes.new(kind)
    bm.to_mesh(m)
    bm.free()
    obj = bpy.data.objects.new(kind, m)
    scene.collection.objects.link(obj)
    obj.scale = scale
    obj.rotation_euler = rot
    obj.location = at
    if bevel > 0:
        mod = obj.modifiers.new('bevel', 'BEVEL')
        mod.width = bevel
        mod.segments = 3
        mod.limit_method = 'NONE'
    for p in m.polygons:
        p.use_smooth = kind != 'cube'
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    out.transform(obj.matrix_world)
    bpy.data.objects.remove(obj)
    return out, [colour] * len(out.vertices)


def extrude_profile(points, width, colour, bevel=0.025):
    """A side profile in the YZ plane, pushed out to `width` across X and rounded off"""
    bm = bmesh.new()
    vs = [bm.verts.new((-width / 2, y, z)) for y, z in points]
    f = bm.faces.new(vs)
    bmesh.ops.extrude_face_region(bm, geom=[f])
    for v in bm.verts:
        if v not in vs:
            v.co.x = width / 2
    bmesh.ops.recalc_face_normals(bm, faces=bm.faces)
    m = bpy.data.meshes.new('profile')
    bm.to_mesh(m)
    bm.free()
    obj = bpy.data.objects.new('profile', m)
    scene.collection.objects.link(obj)
    mod = obj.modifiers.new('bevel', 'BEVEL')
    mod.width = bevel
    mod.segments = 3
    mod.limit_method = 'ANGLE'
    tri = obj.modifiers.new('tri', 'TRIANGULATE')
    tri.quad_method = 'BEAUTY'
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    return out, [colour] * len(out.vertices)


def star_profile(r_out, r_in, cy, cz, points=5):
    return [(cy + (r_out if k % 2 == 0 else r_in) * math.cos(math.pi / 2 + k * math.pi / points),
             cz + (r_out if k % 2 == 0 else r_in) * math.sin(math.pi / 2 + k * math.pi / points)) for k in range(points * 2)]


# ---- Pieces: (mesh, colours, kinds) ----


def piece(m_cols, kinds=None):
    m, cols = m_cols
    return m, list(cols), list(kinds) if kinds is not None else kinds_of(cols)


def decimate(p, faces):
    """Fewer faces, keeping each vertex's colour and kind (carried through as a colour attribute)"""
    m, colours, kinds = p
    if len(m.polygons) <= faces:
        return p
    obj = bpy.data.objects.new('dec', m)
    scene.collection.objects.link(obj)
    attr = m.color_attributes.new('col', 'FLOAT_COLOR', 'POINT')
    for i, (c, k) in enumerate(zip(colours, kinds)):
        attr.data[i].color = (*c, k / 16)
    mod = obj.modifiers.new('dec', 'DECIMATE')
    mod.ratio = faces / len(m.polygons)
    dg = bpy.context.evaluated_depsgraph_get()
    out = bpy.data.meshes.new_from_object(obj.evaluated_get(dg))
    bpy.data.objects.remove(obj)
    a = out.color_attributes.get('col')
    cols = [tuple(a.data[i].color[:3]) for i in range(len(out.vertices))]
    ks = [int(round(a.data[i].color[3] * 16)) for i in range(len(out.vertices))]
    return out, cols, ks


def ambient(groups, rays=40, reach=0.2, strength=0.62):
    """
    How much of the sky over each vertex the model itself hides, worked into its colour: rays cast
    over the hemisphere against every piece in place. `groups` is [(pieces, offset, shade)]; pieces
    with `shade` false only hide the sky from the others.
    """
    verts, tris = [], []
    for pieces, off, _ in groups:
        for m, _c, _k in pieces:
            base = len(verts)
            verts.extend([v.co + off for v in m.vertices])
            m.calc_loop_triangles()
            tris.extend([[base + i for i in t.vertices] for t in m.loop_triangles])
    tree = BVHTree.FromPolygons(verts, tris)
    golden = math.pi * (3 - math.sqrt(5))
    dirs = []
    for k in range(rays):
        z = math.sqrt(1 - (k + 0.5) / rays)
        r = math.sqrt(max(0.0, 1 - z * z))
        dirs.append((r * math.cos(k * golden), r * math.sin(k * golden), z))
    for pieces, off, shade in groups:
        if not shade:
            continue
        for m, cols, _k in pieces:
            for i, v in enumerate(m.vertices):
                n = v.normal
                if n.length < 0.5:
                    continue
                t = n.orthogonal().normalized()
                b = n.cross(t)
                p = v.co + off + n * 0.004
                hit = 0.0
                for dx, dy, dz in dirs:
                    d = t * dx + b * dy + n * dz
                    loc, hn, _i, dist = tree.ray_cast(p, d, reach)
                    # A hit from behind means this vertex is inside another piece: hidden anyway,
                    # and darkening it would bleed into the faces round it
                    if loc is not None and hn.dot(d) < 0:
                        hit += 1 - 0.5 * dist / reach
                f = 1 - strength * hit / rays
                cols[i] = tuple(x * f for x in cols[i])


def pack(pieces, pivot=(0, 0, 0), sharp=None):
    """Join pieces into one indexed buffer in three.js axes, relative to pivot"""
    P, N, C, K, I = [], [], [], [], []
    piv = Vector(pivot)
    for m, colours, kinds in pieces:
        m.calc_loop_triangles()
        for p in m.polygons:
            p.use_smooth = True
        if sharp is not None:
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
                    # Blender (x right, y forward, z up) to three (y up, facing +z)
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
    pv = (-piv.x, piv.z, piv.y)
    print('  ', len(P) // 3, 'verts', len(I) // 3, 'tris')
    return {'p': enc(p), 'n': enc(n), 'c': enc(c), 'k': enc(k), 'i': enc(i), 'pivot': [round(v, 4) for v in pv]}


def three(v):
    """Blender's axes to three's"""
    return [round(-v[0], 4), round(v[2], 4), round(v[1], 4)]


def bell(at, r, out):
    """A sleigh bell: the ball, the slot across its bottom, the loop it hangs by"""
    at = Vector(at)
    parts = [piece(prim('sphere', GOLD, at=tuple(at), scale=(2 * r, 2 * r, 2 * r), segments=16, rings=10)),
             piece(prim('cube', EYE, at=tuple(at + Vector((0, 0, -r * 0.62))), scale=(r * 1.5, r * 0.22, r * 0.5))),
             piece(prim('torus', GOLD, at=tuple(at + Vector((0, 0, r * 1.05))), rot=(math.pi / 2, 0, 0), R=r * 0.35, r=r * 0.12,
                        u=12, v=6))]
    out.extend(parts)


models = {}

# ---- Reindeer: facing +y, standing on z = 0 ----
#
# Built to move: the body; the neck and head on their own from the base of the neck, so the head can
# nod with the stride; each leg in two, the upper from the shoulder or hip and the lower from the knee
# (forelegs) or hock (hind legs), so a leg folds the way a real one does as it's carried forward.

SHOULDER = (0.13, 0.42, 0.86)
KNEE = (0.13, 0.45, 0.43)
HIP = (0.14, -0.42, 0.9)
HOCK = (0.14, -0.57, 0.46)
NECK = (0.0, 0.52, 1.1)

deer = Blob('Deer', 0.016)
deer.ellipsoid((0, 0.0, 0.98), (0.23, 0.48, 0.24), FUR)
deer.ball((0, 0.32, 1.0), 0.255, FUR)
deer.ball((0, -0.35, 1.01), 0.235, FUR)
deer.ellipsoid((0, 0.04, 0.84), (0.15, 0.34, 0.06), CREAM)  # pale belly
deer.ellipsoid((0, 0.48, 0.97), (0.13, 0.1, 0.15), CREAM)  # chest
deer.capsule((0, 0.42, 1.04), (0, 0.54, 1.16), 0.15, FUR)  # the neck's root
for s in (1, -1):
    deer.ellipsoid((s * 0.135, 0.38, 0.84), (0.09, 0.13, 0.17), FUR)  # shoulders
    deer.ellipsoid((s * 0.12, -0.4, 0.9), (0.09, 0.14, 0.17), FUR)  # haunches
    # Tufts on the chest, hanging down
    deer.ellipsoid((s * 0.06, 0.55, 0.88), (0.045, 0.035, 0.075), CREAM, rot=Quaternion((1, 0, 0), 0.3))
deer.ellipsoid((0, 0.57, 0.9), (0.055, 0.04, 0.085), CREAM, rot=Quaternion((1, 0, 0), 0.3))
deer.ellipsoid((0, -0.58, 1.0), (0.12, 0.05, 0.12), RUMP)  # the pale rump
# A short tail, tucked against the rump: brown on top, white under
deer.ellipsoid((0, -0.6, 1.1), (0.045, 0.035, 0.06), FUR, rot=Quaternion((1, 0, 0), 0.4))
deer.ellipsoid((0, -0.605, 1.075), (0.04, 0.03, 0.05), RUMP, rot=Quaternion((1, 0, 0), 0.4))
body = piece(deer.mesh())
m, cols, kinds = body
# The coat darker along the back, lighter low on the flanks; the harness painted on: a red saddle
# cloth over the back edged in gold, a leather girth round the middle, the collar round the neck
for i, v in enumerate(m.vertices):
    x, y, z = v.co
    if cols[i] == FUR:
        cols[i] = mix(FUR, FUR_DARK, smooth(1.0, 1.2, z) * 0.75)
    cloth = abs(y - 0.06) < 0.22 and z > 1.06 - 0.25 * (abs(x) / 0.24) ** 2
    if cloth:
        edge = abs(y - 0.06) > 0.19 or z < 1.09 - 0.25 * (abs(x) / 0.24) ** 2
        cols[i] = GOLD if edge else CLOTH
        kinds[i] = K_METAL if edge else K_FELT
    elif abs(y - 0.24) < 0.028:
        cols[i], kinds[i] = STRAP, K_LEATHER
    elif abs((v.co - Vector((0, 0.5, 1.13))).dot(Vector((0, 0.53, 0.85)))) < 0.035 and y > 0.35:
        cols[i], kinds[i] = STRAP, K_LEATHER
pieces = [decimate(fluffy(body, 0.004, 45.0, seed=20, only=(CREAM, RUMP)), 4500)]
# Tassels along the saddle cloth's lower edges
for s in (1, -1):
    for y in (-0.1, 0.06, 0.22):
        pieces.append(piece(prim('cone', GOLD, at=(s * 0.236, y, 0.815), rot=(0, 0, 0), r1=0.016, r2=0.004, depth=0.05, segments=10)))
        pieces.append(piece(prim('sphere', GOLD, at=(s * 0.236, y, 0.845), scale=(0.022, 0.022, 0.022), segments=10, rings=6)))
# A breast strap round the chest, studded, from the collar back to the girth
strap = [(0.18, 0.4, 1.02), (0.12, 0.58, 0.96), (0, 0.63, 0.94), (-0.12, 0.58, 0.96), (-0.18, 0.4, 1.02)]
pieces.append(piece(smooth_tube('breast', strap, 0.016, STRAP)))
for k in range(5):
    t = (k + 1) / 6
    a = math.pi * t
    pieces.append(piece(prim('sphere', GOLD, at=(0.17 * math.cos(a), 0.4 + 0.22 * math.sin(a), 0.96 + 0.04 * abs(math.cos(a))),
                             scale=(0.018, 0.018, 0.018), segments=10, rings=6)))
# Gold bells round the collar's front: the collar's ring leans forward with the neck
tilt = math.radians(32)
for k in range(5):
    a = math.radians(-64 + k * 32)
    at = Vector((0.165 * math.sin(a), 0.165 * math.cos(a) * math.cos(tilt), -0.165 * math.cos(a) * math.sin(tilt))) + Vector((0, 0.5, 1.13))
    bell(at, 0.021, pieces)
bell((0, 0.24, 0.77), 0.026, pieces)  # the bell under the girth

# The neck and head, from the base of the neck
head = Blob('Head', 0.012)
# A short, deep neck, carried forward
head.capsule(NECK, (0, 0.7, 1.36), 0.15, FUR)
head.ball((0, 0.72, 1.4), 0.12, FUR)
head.ellipsoid((0, 0.62, 1.12), (0.12, 0.13, 0.19), CREAM, rot=Quaternion((1, 0, 0), -0.5))  # the pale mane under the throat
# The mane: long tufts hanging from under the neck
for k in range(7):
    t = k / 6
    p = Vector((0, 0.56, 1.06)).lerp(Vector((0, 0.74, 1.3)), t)
    for s in (-1, 1) if k % 2 else (0,):
        head.ellipsoid(tuple(p + Vector((s * 0.04, 0.02, -0.07))), (0.04, 0.03, 0.075), CREAM, rot=Quaternion((1, 0, 0), -0.25 - 0.3 * t))
head.ball((0, 0.79, 1.47), 0.11, FUR)  # the skull
head.ellipsoid((0, 0.88, 1.45), (0.1, 0.15, 0.1), FUR)
head.ellipsoid((0, 1.0, 1.415), (0.078, 0.09, 0.07), MUZZLE)
head.ellipsoid((0, 0.99, 1.37), (0.05, 0.05, 0.03), CREAM)  # the pale chin
for s in (1, -1):
    head.ellipsoid((s * 0.12, 0.75, 1.55), (0.028, 0.04, 0.075), FUR_DARK, rot=Quaternion((0, 1, 0), s * 1.1))
    # Cheek tufts, and the paler fur round the eyes
    head.ellipsoid((s * 0.085, 0.82, 1.41), (0.03, 0.05, 0.035), CREAM)
    head.ellipsoid((s * 0.082, 0.888, 1.5), (0.026, 0.012, 0.03), CREAM)
hp = piece(head.mesh())
m, cols, kinds = hp
for i, v in enumerate(m.vertices):
    x, y, z = v.co
    if cols[i] == FUR:
        # Darker down the face, lighter round the eyes
        cols[i] = mix(FUR, FUR_DARK, smooth(1.5, 1.62, z) * 0.6)
    # The collar carries on round the neck's root; a leather noseband round the muzzle
    if abs((v.co - Vector((0, 0.5, 1.13))).dot(Vector((0, 0.53, 0.85)))) < 0.035:
        cols[i], kinds[i] = STRAP, K_LEATHER
    elif abs(y - 0.985) < 0.014 and z < 1.5:
        cols[i], kinds[i] = STRAP, K_LEATHER
pieces_head = [decimate(fluffy(hp, 0.004, 45.0, seed=21, only=(CREAM,)), 3600)]
pieces_head.append(piece(prim('sphere', NOSE, at=(0, 1.08, 1.42), scale=(0.07, 0.05, 0.05))))
for s in (1, -1):
    # Nostrils, a mouth line
    pieces_head.append(piece(prim('sphere', EYE, at=(s * 0.02, 1.103, 1.418), scale=(0.016, 0.01, 0.012), segments=10, rings=6)))
    # Eyes set into the head, a glint in each, a heavy upper lid, lashes
    pieces_head.append(piece(prim('sphere', EYE, at=(s * 0.088, 0.895, 1.5), scale=(0.032, 0.03, 0.036))))
    pieces_head.append(piece(prim('sphere', GLINT, at=(s * 0.1, 0.905, 1.512), scale=(0.01, 0.01, 0.01), segments=8, rings=6)))
    pieces_head.append(piece(prim('sphere', FUR, at=(s * 0.089, 0.898, 1.514), scale=(0.034, 0.03, 0.016), segments=12, rings=8)))
    pieces_head.append(piece(smooth_tube('lash', [(s * 0.07, 0.905, 1.508), (s * 0.09, 0.915, 1.51), (s * 0.108, 0.91, 1.515)], 0.0035, EYE)))
    # The inside of the ear
    pieces_head.append(piece(prim('sphere', EAR_IN, at=(s * 0.118, 0.765, 1.55), scale=(0.03, 0.035, 0.11),
                                  rot=(0, s * 1.1, 0), segments=12, rings=8)))
    # Antlers, spreading wide: a beam out and back, curving forward at the top, a brow tine down over
    # the face, tines off the front and the top; darker at the root, a burr where they grow from
    beam = [(0.05, 0.76, 1.56), (0.14, 0.71, 1.64), (0.26, 0.65, 1.72), (0.37, 0.66, 1.82), (0.42, 0.75, 1.92), (0.4, 0.87, 1.98)]
    antler = [smooth_tube('beam', [(s * x, y, z) for x, y, z in beam], 0.036, ANTLER, taper=[1, 0.9, 0.8, 0.7, 0.58, 0.42], steps=4)]
    for tine, r in (([(0.1, 0.74, 1.63), (0.13, 0.84, 1.66), (0.12, 0.93, 1.64)], 0.022),
                    ([(0.23, 0.66, 1.71), (0.28, 0.75, 1.78), (0.3, 0.82, 1.83)], 0.02),
                    ([(0.36, 0.66, 1.8), (0.44, 0.62, 1.88), (0.49, 0.6, 1.94)], 0.019),
                    ([(0.41, 0.74, 1.91), (0.49, 0.8, 1.96), (0.52, 0.85, 2.01)], 0.017),
                    ([(0.4, 0.85, 1.97), (0.35, 0.92, 2.03), (0.33, 0.97, 2.07)], 0.016)):
        antler.append(smooth_tube('tine', [(s * x, y, z) for x, y, z in tine], r, ANTLER, taper=[1, 0.75, 0.45], steps=4))
    for am, ac in antler:
        ac = [mix(ANTLER_BASE, ANTLER, smooth(1.56, 1.8, v.co.z)) for v in am.vertices]
        pieces_head.append((am, ac, [K_BONE] * len(ac)))
    burr, bc = prim('torus', ANTLER_BASE, at=(s * 0.055, 0.758, 1.565), rot=(0, s * 0.6, 0), R=0.036, r=0.014, u=16, v=8)
    pieces_head.append(piece((burr, bc)))
    # Cheek straps from the noseband up to the brow, gold studs
    pieces_head.append(piece(smooth_tube('cheek', [(s * 0.07, 0.975, 1.42), (s * 0.095, 0.88, 1.45), (s * 0.1, 0.78, 1.53)], 0.011, STRAP)))
    pieces_head.append(piece(prim('sphere', GOLD, at=(s * 0.074, 0.975, 1.42), scale=(0.02, 0.02, 0.02), segments=10, rings=6)))
    pieces_head.append(piece(prim('sphere', GOLD, at=(s * 0.1, 0.785, 1.53), scale=(0.018, 0.018, 0.018), segments=10, rings=6)))
pieces_head.append(piece(smooth_tube('mouth', [(-0.04, 1.03, 1.383), (0, 1.052, 1.376), (0.04, 1.03, 1.383)], 0.0035, EYE)))


def leg_piece(parts, extra=(), faces=700):
    blob = Blob('Leg', 0.009)
    for kind, *a in parts:
        getattr(blob, kind)(*a)
    p = piece(blob.mesh())
    m, cols, kinds = p
    for i, v in enumerate(m.vertices):
        if cols[i] in (FUR, FUR_LEG):
            # Darker down the leg
            cols[i] = mix(FUR, FUR_DARK, smooth(0.8, 0.3, v.co.z) * 0.55)
    return [decimate(fluffy(p, 0.005, 60.0, seed=22, only=(SOCK,)), faces)] + [piece(e) for e in extra]


def hoof(y):
    """Cloven: two halves with a gap between, and the dewclaws behind, above"""
    out = []
    for s in (-1, 1):
        out.append(prim('sphere', HOOF, at=(s * 0.024, y + 0.014, 0.038), scale=(0.05, 0.12, 0.08), segments=14, rings=10))
        out.append(prim('sphere', HOOF, at=(s * 0.028, y - 0.05, 0.1), scale=(0.024, 0.03, 0.03), segments=10, rings=6))
    return out


S, K_, H, HK = (0, *SHOULDER[1:]), (0, *KNEE[1:]), (0, *HIP[1:]), (0, *HOCK[1:])
legs = {
    # Foreleg: the forearm, muscled at the top, from the shoulder to the knee
    'leg_fu': leg_piece([('capsule', (0, 0.42, 0.9), (0, 0.425, 0.72), 0.074, FUR),
                         ('capsule', (0, 0.43, 0.72), K_, 0.064, FUR),
                         ('ball', K_, 0.05, FUR_LEG)]),
    # The cannon, a pale sock with tufts over the fetlock, the hoof
    'leg_fl': leg_piece([('capsule', K_, (0, 0.46, 0.08), 0.046, FUR_LEG),
                         ('ellipsoid', (0, 0.465, 0.13), (0.058, 0.062, 0.055), SOCK),
                         ('ellipsoid', (0, 0.44, 0.15), (0.03, 0.03, 0.04), SOCK)], hoof(0.465)),
    # Hind leg: the thigh and gaskin, from the hip down and back to the hock
    'leg_hu': leg_piece([('capsule', (0, -0.42, 0.93), (0, -0.47, 0.7), 0.084, FUR),
                         ('capsule', (0, -0.47, 0.7), HK, 0.066, FUR),
                         ('ball', HK, 0.048, FUR_LEG)]),
    'leg_hl': leg_piece([('capsule', HK, (0, -0.5, 0.08), 0.046, FUR_LEG),
                         ('ellipsoid', (0, -0.495, 0.13), (0.058, 0.062, 0.055), SOCK),
                         ('ellipsoid', (0, -0.52, 0.15), (0.03, 0.03, 0.04), SOCK)], hoof(-0.495)),
}
# Shade the whole reindeer standing, legs in place
ambient([(pieces, Vector(), True), (pieces_head, Vector(), True)] +
        [(legs[name], Vector((s * x, 0, 0)), s > 0) for name, x in (('leg_fu', 0.13), ('leg_fl', 0.13), ('leg_hu', 0.14), ('leg_hl', 0.14))
         for s in (1, -1)], reach=0.2, strength=0.55)
models['deer'] = pack(pieces)
models['deer_head'] = pack(pieces_head, pivot=NECK)
models['leg_fu'] = pack(legs['leg_fu'], pivot=S)
models['leg_fl'] = pack(legs['leg_fl'], pivot=K_)
models['leg_hu'] = pack(legs['leg_hu'], pivot=H)
models['leg_hl'] = pack(legs['leg_hl'], pivot=HK)
# Where everything hangs from, in three's axes: the head from the neck; the legs (two fore, two hind)
# from the shoulders and hips, their lower halves from the knee or hock (relative to the upper's pivot)
models['deer']['neck'] = three(NECK)
models['deer']['legs'] = [
    {'at': three((s * j[0], j[1], j[2])), 'joint': three((0, lo[1] - j[1], lo[2] - j[2])), 'front': front}
    for front, j, lo in ((True, SHOULDER, KNEE), (False, HIP, HOCK)) for s in (1, -1)
]
# Rudolph's nose, relative to the neck
models['deer']['nose'] = three((0, 1.09 - NECK[1], 1.42 - NECK[2]))

# ---- Sleigh: facing +y, runners on z = 0 ----

side = [(-0.62, 0.3), (0.42, 0.3), (0.64, 0.4), (0.78, 0.58), (0.8, 0.76), (0.72, 0.86), (0.62, 0.82),
        (0.6, 0.7), (0.5, 0.6), (0.2, 0.56), (-0.15, 0.6), (-0.42, 0.78), (-0.55, 1.0), (-0.68, 1.04),
        (-0.74, 0.92), (-0.7, 0.6)]
sleigh = []
for x in (-0.38, 0.38):
    m, cols = extrude_profile(side, 0.07, SLEIGH_RED)
    m.transform(Matrix.Translation((x, 0, 0)))
    sleigh.append(piece((m, cols)))
sleigh.append(piece(prim('cube', RED_DARK, at=(0, -0.08, 0.36), scale=(0.74, 1.12, 0.1), bevel=0.02)))
sleigh.append(piece(prim('cube', SLEIGH_RED, at=(0, -0.64, 0.68), scale=(0.74, 0.08, 0.68), bevel=0.03)))
sleigh.append(piece(prim('cube', RED_DARK, at=(0, -0.92, 0.36), scale=(0.7, 0.5, 0.08), bevel=0.02)))
sleigh.append(piece(prim('cube', SLEIGH_RED, at=(0, 0.56, 0.5), scale=(0.74, 0.08, 0.32), bevel=0.03)))
# The seat: a deep green velvet cushion and a back, buttoned
sleigh.append(piece(prim('cube', VELVET, at=(0, -0.3, 0.5), scale=(0.7, 0.5, 0.14), bevel=0.05)))
sleigh.append(piece(prim('cube', VELVET, at=(0, -0.57, 0.78), scale=(0.7, 0.1, 0.42), rot=(math.radians(-12), 0, 0), bevel=0.05)))
for bx in (-0.2, 0.0, 0.2):
    for bz in (0.7, 0.86):
        sleigh.append(piece(prim('sphere', GOLD, at=(bx, -0.51 + (bz - 0.78) * math.tan(math.radians(12)), bz), scale=(0.022, 0.012, 0.022),
                                 segments=10, rings=6)))
for x in (-0.38, 0.38):
    sleigh.append(piece(smooth_tube('trim', [(x * 1.12, y, z) for y, z in [(-0.62, 0.3), (0.42, 0.3), (0.64, 0.4), (0.78, 0.58), (0.8, 0.76), (0.72, 0.86), (0.62, 0.82)]], 0.022, GOLD)))
    sleigh.append(piece(smooth_tube('trim', [(x * 1.12, y, z) for y, z in [(0.5, 0.6), (0.2, 0.56), (-0.15, 0.6), (-0.42, 0.78), (-0.55, 1.0), (-0.68, 1.04), (-0.74, 0.92)]], 0.02, GOLD)))
    # Gold scrolls curling on the side, front and back, and a star between
    sx = x * 1.115
    for cy, cz, sgn in ((0.42, 0.6, 1), (-0.48, 0.74, -1)):
        curl = []
        for k in range(36):
            t = k / 35
            a = sgn * t * 2 * math.pi * 1.55
            r = 0.11 * (1 - 0.8 * t)
            curl.append((sx, cy + r * math.cos(a), cz + r * math.sin(a)))
        sleigh.append(piece(smooth_tube('scroll', curl, 0.011, GOLD, steps=2)))
    m, cols = extrude_profile(star_profile(0.07, 0.03, 0.0, 0.44), 0.02, GOLD, bevel=0.006)
    m.transform(Matrix.Translation((sx, 0, 0)))
    sleigh.append(piece((m, cols)))
    # Runners, curling up at the front, and the struts that hold them
    run = [(-1.2, 0.12), (-1.05, 0.03), (-0.3, 0.02), (0.4, 0.02), (0.8, 0.06), (1.02, 0.18), (1.06, 0.34), (0.96, 0.42), (0.88, 0.34)]
    sleigh.append(piece(smooth_tube('runner', [(x * 1.05, y, z) for y, z in run], 0.03, GOLD)))
    for y in (-0.95, -0.5, 0.0, 0.42):
        sleigh.append(piece(smooth_tube('strut', [(x * 1.05, y, 0.03), (x * 1.0, y, 0.31)], 0.018, GOLD)))

# ---- Santa, sitting in the sleigh, the reins in his hands ----

R_SHOULDER = (0.2, -0.29, 0.93)
R_HAND = (0.235, 0.105, 0.77)
L_HAND = (-0.235, 0.105, 0.77)


def fur_tube(points, r, amp=0.011, freq=55.0, seed=0.0, faces=2600):
    """A band of white fur: a tube through points, its surface pushed about into tufts"""
    return decimate(fluffy(piece(smooth_tube('fur', points, r, WHITE, steps=3, res=6)), amp, freq, seed), faces)


coat = Blob('Santa', 0.011, 1.3)
coat.ellipsoid((0, -0.31, 0.83), (0.24, 0.2, 0.25), RED)  # chest
coat.ball((0, -0.21, 0.72), 0.22, RED)  # the round belly
coat.ellipsoid((0, -0.27, 0.63), (0.26, 0.21, 0.09), RED)  # sitting
coat.ball((-0.2, -0.29, 0.93), 0.085, RED)  # left shoulder (the right is the arm's)
coat.ball((0.17, -0.3, 0.9), 0.07, RED)
for s in (1, -1):
    coat.capsule((s * 0.12, -0.12, 0.6), (s * 0.13, 0.14, 0.58), 0.085, RED)  # thighs
    coat.capsule((s * 0.13, 0.14, 0.58), (s * 0.15, 0.2, 0.52), 0.066, RED)  # shins, into the boots
# The left arm, holding his rein
coat.capsule((-0.2, -0.29, 0.93), (-0.27, -0.16, 0.75), 0.064, RED)
coat.capsule((-0.27, -0.16, 0.75), (-0.235, 0.05, 0.77), 0.055, RED)
santa = [decimate(piece(coat.mesh()), 7000)]


def belly_front(z):
    a = -0.21 + math.sqrt(max(0.0, 0.235 ** 2 - (z - 0.72) ** 2))
    b = -0.31 + 0.215 * math.sqrt(max(0.0, 1 - ((z - 0.83) / 0.26) ** 2))
    return max(a, b)


# Fur trim, fluffy: round the hem, down the front, the collar, the left cuff, the tops of the boots
hem = []
for k in range(51):
    a = 2 * math.pi * k / 48
    hem.append((0.3 * math.cos(a), -0.23 + 0.28 * math.sin(a), 0.635 + 0.05 * max(0.0, math.sin(a))))
santa.append(fur_tube(hem, 0.042, seed=1, faces=4000))
santa.append(fur_tube([(0, belly_front(z) - 0.006, z) for z in [0.64 + k * 0.03 for k in range(12)]], 0.032, seed=2))
santa.append(fur_tube(loop((0, -0.27, 0.985), (0, 0.25, 1), 0.128), 0.04, seed=3))
santa.append(fur_tube(loop((-0.237, 0.04, 0.77), (0.16, 0.98, 0.09), 0.062, n=32), 0.03, amp=0.008, seed=4, faces=1600))
for s in (1, -1):
    santa.append(fur_tube(loop((s * 0.15, 0.21, 0.585), (0, 0, 1), 0.07, n=32), 0.032, amp=0.008, seed=5 + s, faces=1600))

# The belt, its buckle (a frame and its prong)
belt, bc = prim('torus', BELT, at=(0, -0.21, 0.7), R=0.258, r=0.026, u=48, v=8)
santa.append(piece((belt, bc)))
for at, sc in (((0, 0.05, 0.74), (0.1, 0.012, 0.014)), ((0, 0.05, 0.66), (0.1, 0.012, 0.014)),
               ((-0.043, 0.05, 0.7), (0.014, 0.012, 0.08)), ((0.043, 0.05, 0.7), (0.014, 0.012, 0.08)),
               ((-0.016, 0.056, 0.7), (0.05, 0.008, 0.008))):
    santa.append(piece(prim('cube', GOLD, at=at, scale=sc, bevel=0.003)))
# Boots: the shaft, the foot, the sole
for s in (1, -1):
    santa.append(piece(prim('cone', BOOT, at=(s * 0.15, 0.21, 0.51), r1=0.066, r2=0.07, depth=0.15, segments=24)))
    santa.append(piece(prim('sphere', BOOT, at=(s * 0.15, 0.275, 0.455), scale=(0.13, 0.23, 0.09))))
    santa.append(piece(prim('cube', SOLE, at=(s * 0.15, 0.28, 0.418), scale=(0.13, 0.24, 0.02), bevel=0.008)))
# The left glove round its rein: the fist, the thumb over it, the glove's cuff
santa.append(piece(prim('sphere', GLOVE, at=L_HAND, scale=(0.085, 0.1, 0.08))))
santa.append(piece(prim('sphere', GLOVE, at=(-0.205, 0.11, 0.795), scale=(0.04, 0.05, 0.035), segments=12, rings=8)))

# The head: a face with rosy cheeks, ears, a round nose
face = Blob('Face', 0.006, 1.4)
face.ball((0, -0.26, 1.11), 0.125, SKIN)
for s in (1, -1):
    face.ball((s * 0.066, -0.165, 1.085), 0.045, CHEEK)
    face.ellipsoid((s * 0.122, -0.27, 1.115), (0.022, 0.03, 0.04), SKIN)
santa.append(decimate(piece(face.mesh()), 5000))
santa.append(piece(prim('sphere', NOSE_SKIN, at=(0, -0.126, 1.115), scale=(0.072, 0.066, 0.066), segments=24, rings=16)))
for s in (1, -1):
    # Twinkling eyes, half shut under the lids with smiling
    santa.append(piece(prim('sphere', EYE, at=(s * 0.046, -0.146, 1.15), scale=(0.03, 0.022, 0.034), segments=14, rings=10)))
    santa.append(piece(prim('sphere', GLINT, at=(s * 0.04, -0.135, 1.158), scale=(0.009, 0.009, 0.009), segments=8, rings=6)))
    santa.append(piece(prim('sphere', SKIN, at=(s * 0.046, -0.148, 1.164), scale=(0.037, 0.026, 0.018), segments=14, rings=10)))
    # Round gold spectacles: rims, the temples back to the ears
    rim, rc = prim('torus', GOLD, at=(s * 0.046, -0.134, 1.15), rot=(math.pi / 2, 0, 0), R=0.026, r=0.0034, u=24, v=6)
    santa.append(piece((rim, rc)))
    santa.append(piece(smooth_tube('temple', [(s * 0.072, -0.137, 1.152), (s * 0.106, -0.19, 1.158), (s * 0.121, -0.26, 1.15)], 0.0032, GOLD)))
santa.append(piece(smooth_tube('bridge', [(-0.02, -0.131, 1.156), (0, -0.124, 1.164), (0.02, -0.131, 1.156)], 0.0032, GOLD)))

# White hair: the beard in curls, the sideburns, the hair under the hat; the moustache; bushy eyebrows
beard = Blob('Beard', 0.006, 1.35)
beard.ellipsoid((0, -0.205, 1.0), (0.125, 0.085, 0.11), WHITE)
beard.ball((0, -0.165, 0.905), 0.05, WHITE)
for s in (1, -1):
    beard.ball((s * 0.06, -0.16, 0.96), 0.05, WHITE)
    beard.ball((s * 0.115, -0.235, 1.09), 0.04, WHITE)
    beard.ball((s * 0.116, -0.22, 1.05), 0.042, WHITE)
    beard.ball((s * 0.115, -0.3, 1.14), 0.045, WHITE)
    beard.ball((s * 0.09, -0.36, 1.16), 0.045, WHITE)
beard.ball((0, -0.38, 1.15), 0.05, WHITE)
santa.append(decimate(fluffy(piece(beard.mesh()), 0.014, 38.0, seed=7), 10000))
stache = Blob('Moustache', 0.005, 1.4)
for s in (1, -1):
    stache.capsule((0, -0.116, 1.088), (s * 0.05, -0.126, 1.078), 0.021, WHITE)
    stache.capsule((s * 0.05, -0.126, 1.078), (s * 0.085, -0.138, 1.09), 0.016, WHITE)
    stache.ball((s * 0.094, -0.144, 1.102), 0.012, WHITE)
santa.append(decimate(fluffy(piece(stache.mesh()), 0.004, 95.0, seed=9), 2500))
brows = Blob('Brows', 0.004, 1.4)
for s in (1, -1):
    for (x, y, z), r in zip(((0.025, -0.15, 1.186), (0.047, -0.153, 1.193), (0.07, -0.16, 1.189), (0.088, -0.17, 1.181)),
                            (0.014, 0.017, 0.016, 0.013)):
        brows.ball((s * x, y, z), r, WHITE)
santa.append(decimate(fluffy(piece(brows.mesh()), 0.003, 130.0, seed=10), 1500))

# The hat: a soft red cone flopping back, a fluffy band, a fluffy pompom
hat = [(0, -0.27, 1.205), (0, -0.285, 1.3), (0, -0.32, 1.38), (0.01, -0.41, 1.435), (0.05, -0.51, 1.43), (0.09, -0.58, 1.37)]
santa.append(piece(smooth_tube('hat', hat, 0.135, RED, taper=[1, 0.83, 0.62, 0.42, 0.26, 0.14], res=6)))
santa.append(fur_tube(loop((0, -0.27, 1.205), (0, -0.14, 1), 0.133, n=40), 0.043, amp=0.012, seed=11, faces=4000))
pom = piece(prim('sphere', WHITE, at=(0.1, -0.6, 1.33), scale=(0.11, 0.11, 0.11), segments=36, rings=22))
santa.append(decimate(fluffy(pom, 0.016, 42.0, seed=12), 2000))

# The right arm, on its own from the shoulder so he can throw
arm = Blob('Arm', 0.011, 1.3)
arm.ball(R_SHOULDER, 0.085, RED)
arm.capsule(R_SHOULDER, (0.27, -0.16, 0.75), 0.064, RED)
arm.capsule((0.27, -0.16, 0.75), (0.235, 0.05, 0.77), 0.055, RED)
arm_pieces = [decimate(piece(arm.mesh()), 2500)]
arm_pieces.append(fur_tube(loop((0.237, 0.04, 0.77), (-0.16, 0.98, 0.09), 0.062, n=32), 0.03, amp=0.008, seed=13, faces=1600))
arm_pieces.append(piece(prim('sphere', GLOVE, at=R_HAND, scale=(0.085, 0.1, 0.08))))
arm_pieces.append(piece(prim('sphere', GLOVE, at=(0.205, 0.11, 0.795), scale=(0.04, 0.05, 0.035), segments=12, rings=8)))

# ---- The sack of presents behind him ----

sk = Blob('Sack', 0.016)
sk.ellipsoid((0, -0.92, 0.72), (0.3, 0.26, 0.32), SACK)
sk.ball((0.06, -0.94, 1.0), 0.18, SACK)
sk.capsule((0, -0.94, 1.08), (0, -0.96, 1.2), 0.07, SACK)
sack = [decimate(piece(sk.mesh()), 3000)]
sack.append(piece(smooth_tube('tie', [(-0.07, -0.93, 1.12), (0, -0.88, 1.13), (0.07, -0.93, 1.12), (0.04, -1.0, 1.12), (-0.04, -1.0, 1.12),
                                      (-0.07, -0.93, 1.12)], 0.016, ROPE)))
sack.append(piece(smooth_tube('tie_end', [(0.07, -0.93, 1.12), (0.1, -0.88, 1.08), (0.11, -0.86, 1.02)], 0.012, ROPE)))
for at, size, rot, c in [
    ((0.12, -0.88, 1.24), (0.16, 0.16, 0.16), (0.2, 0.3, 0.5), rgb('#2E7DD1')),
    ((-0.14, -0.98, 1.22), (0.14, 0.14, 0.18), (-0.3, 0.1, -0.4), rgb('#F2C230')),
    ((0.02, -1.04, 1.3), (0.12, 0.12, 0.12), (0.5, -0.2, 0.2), rgb('#2BA36B')),
]:
    sack.append(piece(prim('cube', c, at=at, scale=size, rot=rot, bevel=0.012)))
    sack.append(piece(prim('cube', RIBBON, at=at, scale=(size[0] * 1.02, size[1] * 0.22, size[2] * 1.02), rot=rot)))
    sack.append(piece(prim('cube', RIBBON, at=at, scale=(size[0] * 0.22, size[1] * 1.02, size[2] * 1.02), rot=rot)))

# Shade them all together: the sleigh round Santa, the sack behind him
ambient([(sleigh, Vector(), True), (santa, Vector(), True), (arm_pieces, Vector(), True), (sack, Vector(), True)], reach=0.12, strength=0.42)
models['sleigh'] = pack(sleigh, sharp=math.radians(40))
models['santa'] = pack(santa)
models['santa_arm'] = pack(arm_pieces, pivot=R_SHOULDER)
models['sack'] = pack(sack)
# The arm hangs from his shoulder; his hands (the right one's relative to the shoulder), where the reins go
models['santa']['arm'] = three(R_SHOULDER)
models['santa']['hand_r'] = three(Vector(R_HAND) - Vector(R_SHOULDER))
models['santa']['hand_l'] = three(L_HAND)

with open(os.path.join(OUT, 'models.json'), 'w') as f:
    json.dump(models, f, separators=(',', ':'))
print('saved models.json', os.path.getsize(os.path.join(OUT, 'models.json')) // 1024, 'KB')
