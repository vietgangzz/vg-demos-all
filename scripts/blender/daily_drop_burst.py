"""
The seal on Daily Drop's chest, and the moment it breaks, simulated in Blender's rigid body world
(Bullet) and baked for the app to play back.

The chest is bound shut: an iron chain belted round its body, two more draped over its lid, and a
big padlock hung at the front from its hasp. When it bursts (the app drives the build-up: the
chains rattle and glow, cracks of light spread over the padlock along the lines it'll break on), a
blast from the padlock throws it apart into its pieces and whips the chains off, the lid is flung
open on its hinge and smacks the chains lying over it away, and a geyser out of the chest throws
coins and gems up into the air. All of it falls, tumbles and bounces off the chest, the dais and
the vault floor, the links still linked (each to the next by a point joint), and settles.

Builds the chest first (daily_drop_models.py, which also writes models.json), then writes
assets/daily-drop/burst.json, in three.js axes (y up, facing +z):
  - the pieces' shapes, packed like models.json's: a chain link, the padlock's fragments, the
    shackle's two halves; for each fragment, where it sits at rest and the planes it was cut along
    (for the cracks that spread over it before it breaks)
  - the motion, 30 times a second for SECONDS: for each body, its position (int16, a third of a
    millimetre) and rotation (an int16 quaternion), grouped by kind (links, coins, gems, pieces)
  - the lid's opening, as the angle of its hinge each frame
  - every hard knock (a body's speed jumping), for the app's clinks and the buzz in the hand
  - for each link, how far along the chains it is from the padlock (the glow runs out along them)

Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/daily_drop_burst.py -- <out dir> [--preview <dir>]
--preview renders a few frames of it with the workbench engine, from where the app's camera is.
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
from mathutils import Euler, Matrix, Quaternion, Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import daily_drop_models as M  # noqa: E402  (builds the chest, writes models.json)

scene = bpy.context.scene
OUT = M.OUT
PREVIEW = sys.argv[sys.argv.index('--preview') + 1] if '--preview' in sys.argv else None
rnd = random.Random(23)

K_CHAIN, K_LOCK, K_SHARD = 11, 12, 13


def three(v):
    """Blender's axes (x right, y toward the viewer, z up) to three's (y up, facing +z)"""
    return [round(-v[0], 4), round(v[2], 4), round(v[1], 4)]
IRON_DARK = M.rgb('#3A3542')
IRON_EDGE = M.rgb('#5B5466')
SHARD = M.rgb('#FFD27A')

W, D, H, R = M.W, M.D, M.H, M.R
HINGE = Vector(M.HINGE)

SIM_FPS = 60
FPS = 30
SECONDS = 3.0
FRAMES = int(SIM_FPS * SECONDS) + 1

# ---- The chain's links ----

# Inside length and width of a link, the wire's radius: links are LINK apart along the chain
LINK = 0.06
LINK_W = 0.026
WIRE = 0.009


def link_mesh():
    """A stadium-shaped ring of round wire round its own origin, its length along x, in the xy plane"""
    rc = LINK_W / 2 + WIRE
    straight = LINK - LINK_W
    pts = []
    n_arc = 12
    for side in (1, -1):
        cx = side * straight / 2
        for k in range(n_arc + 1):
            a = -math.pi / 2 + math.pi * k / n_arc
            a = a if side == 1 else a + math.pi
            pts.append(Vector((cx + rc * math.cos(a), rc * math.sin(a), 0)))
    bm = bmesh.new()
    rings = []
    seg = 8
    for i, p in enumerate(pts):
        q = pts[(i + 1) % len(pts)]
        o = pts[(i - 1) % len(pts)]
        t = (q - o).normalized()
        nrm = Vector((0, 0, 1)).cross(t).normalized()
        ring = []
        for j in range(seg):
            b = 2 * math.pi * j / seg
            d = nrm * math.cos(b) + Vector((0, 0, 1)) * math.sin(b)
            ring.append(bm.verts.new(p + d * WIRE))
        rings.append(ring)
    for i in range(len(rings)):
        a, b = rings[i], rings[(i + 1) % len(rings)]
        for j in range(seg):
            bm.faces.new((a[j], a[(j + 1) % seg], b[(j + 1) % seg], b[j]))
    m = bpy.data.meshes.new('link')
    bm.to_mesh(m)
    bm.free()
    for p in m.polygons:
        p.use_smooth = True
    # Darker where the wire's inside faces the hole: worn bright on the outside
    cols = []
    for v in m.vertices:
        r = math.hypot(max(abs(v.co.x) - straight / 2, 0), v.co.y)
        cols.append(M.mix(IRON_DARK, IRON_EDGE, max(0.0, min(1.0, (r - rc + WIRE) / (2 * WIRE)))))
    return m, cols, [K_CHAIN] * len(m.vertices)


def resample(path, step):
    """Points every `step` along a polyline, with the direction it runs and which way is out"""
    out = []
    seglens = [(path[i + 1][0] - path[i][0]).length for i in range(len(path) - 1)]
    total = sum(seglens)
    n = int(total // step)
    for k in range(n + 1):
        s = k * step
        i = 0
        while i < len(seglens) - 1 and s > seglens[i]:
            s -= seglens[i]
            i += 1
        a, na = path[i]
        b, nb = path[i + 1]
        t = min(1.0, s / max(seglens[i], 1e-9))
        out.append((a.lerp(b, t), (b - a).normalized(), na.lerp(nb, t).normalized()))
    return out, total


def belt_path(z, gap):
    """Round the chest's body at height z, from the front just right of the padlock, all the way
    round, back to just left of it; the corners rounded. Points with the way out from the chest"""
    hx, hy, r = W / 2, D / 2, 0.07
    pts = []

    def corner(cx, cy, a0, a1):
        for k in range(9):
            a = a0 + (a1 - a0) * k / 8
            n = Vector((math.cos(a), math.sin(a), 0))
            pts.append((Vector((cx, cy, z)) + n * r, n))

    pts.append((Vector((gap, hy, z)), Vector((0, 1, 0))))
    pts.append((Vector((hx - r, hy, z)), Vector((0, 1, 0))))
    corner(hx - r, hy - r, math.pi / 2, 0)
    pts.append((Vector((hx, -hy + r, z)), Vector((1, 0, 0))))
    corner(hx - r, -hy + r, 0, -math.pi / 2)
    pts.append((Vector((-hx + r, -hy, z)), Vector((0, -1, 0))))
    corner(-hx + r, -hy + r, -math.pi / 2, -math.pi)
    pts.append((Vector((-hx, hy - r, z)), Vector((-1, 0, 0))))
    corner(-hx + r, hy - r, math.pi, math.pi / 2)
    pts.append((Vector((-gap, hy, z)), Vector((0, 1, 0))))
    return pts


def drape_path(x, z0):
    """Over the lid at x, from the front at height z0, up and over, down the back to z0"""
    pts = [(Vector((x, D / 2, z0)), Vector((0, 1, 0))), (Vector((x, D / 2, H - 0.02)), Vector((0, 1, 0)))]
    for k in range(25):
        a = k * math.pi / 24
        n = Vector((0, math.cos(a), math.sin(a)))
        pts.append((Vector((x, 0, H)) + n * R, n))
    pts.append((Vector((x, -D / 2, H - 0.02)), Vector((0, -1, 0))))
    pts.append((Vector((x, -D / 2, z0)), Vector((0, -1, 0))))
    return pts


def chain_links(path, lift_flat, lift_standing):
    """Links along a path: every other one lying flat against the chest, the others standing out
    from it, each a little off the surface. Their places and rotations, and where they joint"""
    points, total = resample(path, LINK)
    links = []
    for k, (p, t, n) in enumerate(points):
        flat = k % 2 == 0
        n = (n - t * n.dot(t)).normalized()
        side = n.cross(t).normalized()
        # The link's own x along the chain; its ring's plane lying on the chest, or standing out of it
        y_axis = side if flat else n
        z_axis = t.cross(y_axis).normalized()
        rot = Matrix((t, y_axis, z_axis)).transposed()
        at = p + n * (lift_flat if flat else lift_standing)
        links.append((at, rot, n))
    return links, total


# ---- The padlock ----

LOCK_W = 0.16
LOCK_H = 0.14
LOCK_D = 0.062
LOCK_Z = 0.36  # the middle of its body
LOCK_Y = D / 2 + 0.016 + 0.006 + LOCK_D / 2 + 0.012  # in front of the lock plate and the hasp


def outline(w, h, r_top, r_bottom, n=8):
    """A padlock's body seen from the front, round its middle: corners rounded, the bottom ones more"""
    pts = []

    def arc(cx, cy, r, a0, a1):
        for k in range(n + 1):
            a = a0 + (a1 - a0) * k / n
            pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))

    hw, hh = w / 2, h / 2
    arc(hw - r_top, hh - r_top, r_top, 0, math.pi / 2)
    arc(-hw + r_top, hh - r_top, r_top, math.pi / 2, math.pi)
    arc(-hw + r_bottom, -hh + r_bottom, r_bottom, math.pi, 1.5 * math.pi)
    arc(hw - r_bottom, -hh + r_bottom, r_bottom, 1.5 * math.pi, 2 * math.pi)
    return pts


def padlock_parts():
    """The padlock in place, as one bmesh of its parts, each vertex with its colour and kind"""
    upright = Euler((math.pi / 2, 0, 0)).to_matrix()
    at = Vector((0, LOCK_Y, LOCK_Z))
    parts = [
        # The iron body; a gold face on it; the keyhole; a gold rim round the face; rivets
        M.slab(outline(LOCK_W, LOCK_H, 0.018, 0.05), LOCK_D, IRON_DARK, K_LOCK, M.place(at, upright), bevel=0.008),
        M.slab(outline(LOCK_W - 0.03, LOCK_H - 0.03, 0.01, 0.038), 0.008, M.GOLD, M.K_GOLD,
               M.place(at + Vector((0, LOCK_D / 2 + 0.002, 0)), upright), bevel=0.003),
        M.slab([(0.013 * math.cos(a), 0.012 + 0.013 * math.sin(a)) for a in [2 * math.pi * k / 16 for k in range(16)]],
               0.006, M.rgb('#140F18'), K_LOCK, M.place(at + Vector((0, LOCK_D / 2 + 0.006, 0)), upright)),
        M.slab([(-0.006, 0.0), (-0.011, -0.04), (0.011, -0.04), (0.006, 0.0)], 0.006, M.rgb('#140F18'), K_LOCK,
               M.place(at + Vector((0, LOCK_D / 2 + 0.006, 0)), upright)),
    ]
    for x, z in ((-0.052, 0.042), (0.052, 0.042), (-0.052, -0.036), (0.052, -0.036)):
        parts.append(M.dome(0.007, M.GOLD_DEEP, M.K_GOLD,
                            M.place(at + Vector((x, LOCK_D / 2 + 0.006, z)), (-math.pi / 2, 0, 0))))
    return parts


def shackle_halves():
    """The shackle: a thick U of bright steel up out of the body's top and through the hasp, in two
    halves (it snaps at the top)"""
    r_bend = 0.042
    wire = 0.012
    top = LOCK_Z + LOCK_H / 2
    halves = []
    for side in (1, -1):
        pts = [Vector((side * r_bend, LOCK_Y - 0.004, top - 0.01)), Vector((side * r_bend, LOCK_Y - 0.004, top + 0.05))]
        for k in range(1, 9):
            a = (math.pi / 2) * k / 8
            pts.append(Vector((side * r_bend * math.cos(a), LOCK_Y - 0.004, top + 0.05 + r_bend * math.sin(a))))
        m, cols = tube(pts, wire, M.rgb('#C9CFD8'))
        halves.append((m, cols, [M.K_IRON] * len(cols)))
    return halves


def tube(points, radius, colour, seg=10):
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
    m = bpy.data.meshes.new('tube')
    bm.to_mesh(m)
    bm.free()
    for p in m.polygons:
        p.use_smooth = True
    return m, [colour] * len(m.vertices)


def join(parts):
    """Pieces (mesh, colours, kinds) into one bmesh with the colour and kind on each vertex"""
    bm = bmesh.new()
    col = bm.verts.layers.float_color.new('col')
    knd = bm.verts.layers.int.new('kind')
    for m, cols, kinds in parts:
        base = len(bm.verts)
        tmp = bmesh.new()
        tmp.from_mesh(m)
        tmp.verts.ensure_lookup_table()
        vmap = {}
        for v in tmp.verts:
            nv = bm.verts.new(v.co)
            nv[col] = (*cols[v.index], 1.0)
            nv[knd] = kinds[v.index]
            vmap[v] = nv
        for f in tmp.faces:
            try:
                bm.faces.new([vmap[v] for v in f.verts])
            except ValueError:
                pass
        tmp.free()
        del base
    return bm


def cut(bm, plane_co, plane_no):
    """The two halves of a bmesh, cut by a plane, each closed off where it was cut. The new faces
    are the broken inside: their own vertices, coloured and marked as such"""
    halves = []
    for keep_front in (True, False):
        b = bm.copy()
        col = b.verts.layers.float_color['col']
        knd = b.verts.layers.int['kind']
        geom = b.verts[:] + b.edges[:] + b.faces[:]
        res = bmesh.ops.bisect_plane(b, geom=geom, plane_co=plane_co, plane_no=plane_no,
                                     clear_inner=keep_front, clear_outer=not keep_front)
        on_cut = [e for e in res['geom_cut'] if isinstance(e, bmesh.types.BMEdge)]
        # The cut's outline, filled with faces of fresh vertices of its own
        b.edges.ensure_lookup_table()
        loops = boundary_loops([e for e in on_cut if e.is_boundary])
        for loop in loops:
            if len(loop) < 3:
                continue
            nvs = []
            for v in loop:
                nv = b.verts.new(v.co)
                nv[col] = (*SHARD, 1.0)
                nv[knd] = K_SHARD
                nvs.append(nv)
            try:
                f = b.faces.new(nvs)
                # Facing out of the piece: away from the side that's kept
                n = f.normal
                keep_dir = Vector(plane_no) * (1 if keep_front else -1)
                if n.dot(keep_dir) > 0:
                    f.normal_flip()
            except ValueError:
                pass
        bmesh.ops.triangulate(b, faces=b.faces[:])
        halves.append(b)
    return halves


def boundary_loops(edges):
    """Closed loops of vertices round a set of boundary edges"""
    left = set(edges)
    loops = []
    while left:
        e = left.pop()
        loop = [e.verts[0], e.verts[1]]
        while True:
            last = loop[-1]
            nxt = None
            for e2 in last.link_edges:
                if e2 in left:
                    nxt = e2
                    break
            if nxt is None:
                break
            left.discard(nxt)
            v = nxt.other_vert(last)
            if v is loop[0]:
                break
            loop.append(v)
        loops.append(loop)
    return loops


def fracture(bm, depth, planes, centre):
    """Cut it in two by a plane through `centre` at some angle, then each half again, `depth` times.
    The pieces, each with the planes it was cut along"""
    if depth == 0:
        return [(bm, planes)]
    # Mostly across the face, so the cracks show from the front
    a = rnd.uniform(0, math.pi)
    tilt = rnd.uniform(-0.35, 0.35)
    no = Vector((math.cos(a), math.sin(tilt) * 0.5, math.sin(a))).normalized()
    co = centre + Vector((rnd.uniform(-0.012, 0.012), 0, rnd.uniform(-0.012, 0.012)))
    front, back = cut(bm, co, no)
    out = []
    for piece, sign in ((front, 1), (back, -1)):
        if len(piece.verts) < 8:
            continue
        c = sum((v.co for v in piece.verts), Vector()) / len(piece.verts)
        out.extend(fracture(piece, depth - 1, planes + [(co.copy(), no * sign)], c))
    return out


def to_mesh(b):
    """A bmesh with colour and kind layers into (mesh, colours, kinds), its origin left where it is"""
    col = b.verts.layers.float_color['col']
    knd = b.verts.layers.int['kind']
    b.verts.ensure_lookup_table()
    cols = [tuple(v[col][:3]) for v in b.verts]
    kinds = [v[knd] for v in b.verts]
    m = bpy.data.meshes.new('piece')
    b.to_mesh(m)
    return m, cols, kinds


# ---- Bodies in the rigid body world ----

bpy.ops.rigidbody.world_add()
rbw = scene.rigidbody_world
rbw.substeps_per_frame = 20
rbw.solver_iterations = 30
rbw.point_cache.frame_start = 1
rbw.point_cache.frame_end = FRAMES
scene.frame_start = 1
scene.frame_end = FRAMES
scene.render.fps = SIM_FPS
scene.gravity = (0, 0, -9.81)


def obj_from(mesh_cols_kinds, name, origin=None):
    """An object for a piece, its origin moved to `origin` (its centre of mass by default)"""
    m, cols, kinds = mesh_cols_kinds
    if origin is None:
        origin = sum((v.co for v in m.vertices), Vector()) / max(1, len(m.vertices))
    m.transform(Matrix.Translation(-origin))
    o = bpy.data.objects.new(name, m)
    o.location = origin
    scene.collection.objects.link(o)
    return o, (m, cols, kinds)


def rigid(o, kind='ACTIVE', shape='CONVEX_HULL', mass=0.02, friction=0.55, bounce=0.25, margin=0.0015):
    bpy.ops.object.select_all(action='DESELECT')
    bpy.context.view_layer.objects.active = o
    o.select_set(True)
    bpy.ops.rigidbody.object_add(type=kind)
    rb = o.rigid_body
    rb.collision_shape = shape
    rb.friction = friction
    rb.restitution = bounce
    rb.use_margin = True
    rb.collision_margin = margin
    if kind == 'ACTIVE':
        rb.mass = mass
        rb.linear_damping = 0.25
        rb.angular_damping = 0.3
    return rb


def launch(o, v, spin, frame):
    """Let it go at `frame` already moving at v (metres a second) and turning at `spin` (radians a
    second round x, y, z): held (kinematic) until then, its last held step the way it'd go in a frame,
    which the simulation carries on with when it's let go the frame after"""
    p0 = o.location.copy()
    r0 = o.rotation_euler.copy()
    o.rigid_body.kinematic = True
    o.rigid_body.keyframe_insert('kinematic', frame=1)
    o.keyframe_insert('location', frame=frame - 1)
    o.keyframe_insert('rotation_euler', frame=frame - 1)
    o.location = p0 + Vector(v) / SIM_FPS
    o.rotation_euler = (r0.x + spin[0] / SIM_FPS, r0.y + spin[1] / SIM_FPS, r0.z + spin[2] / SIM_FPS)
    o.keyframe_insert('location', frame=frame)
    o.keyframe_insert('rotation_euler', frame=frame)
    o.rigid_body.keyframe_insert('kinematic', frame=frame)
    o.rigid_body.kinematic = False
    o.rigid_body.keyframe_insert('kinematic', frame=frame + 1)


def spin_of(lo, hi):
    a = Vector((rnd.uniform(-1, 1), rnd.uniform(-1, 1), rnd.uniform(-1, 1))).normalized()
    return tuple(a * rnd.uniform(lo, hi))


def box(name, size, at, kind='PASSIVE', parent=None):
    bm = bmesh.new()
    bmesh.ops.create_cube(bm, size=1.0)
    bmesh.ops.scale(bm, vec=Vector(size), verts=bm.verts)
    m = bpy.data.meshes.new(name)
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(name, m)
    scene.collection.objects.link(o)
    if parent is not None:
        o.parent = parent
    o.location = at
    o.display_type = 'WIRE'
    rigid(o, kind, 'BOX', bounce=0.3)
    o.hide_render = True
    return o


def cylinder_body(name, r, h, at):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=48, radius1=r, radius2=r, depth=h)
    m = bpy.data.meshes.new(name)
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(name, m)
    scene.collection.objects.link(o)
    o.location = at
    rigid(o, 'PASSIVE', 'CYLINDER', friction=0.7, bounce=0.35)
    o.hide_render = True
    return o


print('colliders')
# The vault floor, the dais' two steps
box('floor', (12, 12, 1), (0, 0, -0.2 - 0.5))
cylinder_body('dais', 0.95, 0.12, (0, 0, -0.06))
cylinder_body('step', 1.1, 0.08, (0, 0, -0.16))
# The chest's walls and its floor, the heap inside
T = M.T
box('front', (W, T, H), (0, D / 2 - T / 2, H / 2))
box('back', (W, T, H), (0, -D / 2 + T / 2, H / 2))
box('left', (T, D, H), (-W / 2 + T / 2, 0, H / 2))
box('right', (T, D, H), (W / 2 - T / 2, 0, H / 2))
box('heap', (W - 2 * T, D - 2 * T, 0.12), (0, 0, 0.30))
# The lid, on its hinge: a pivot that turns, and staves round its curve that turn with it
pivot = bpy.data.objects.new('pivot', None)
scene.collection.objects.link(pivot)
pivot.location = HINGE
staves = []
for i in range(9):
    th = (i + 0.5) * math.pi / 9
    c = Vector((0, R * math.cos(th) - 0.022 * math.cos(th), H + R * math.sin(th) - 0.022 * math.sin(th)))
    s = box(f'stave{i}', (W, R * math.pi / 9 + 0.01, 0.044), c - HINGE, kind='PASSIVE', parent=pivot)
    s.rotation_euler = (th - math.pi / 2, 0, 0)
    s.rigid_body.kinematic = True
    staves.append(s)
for sx in (1, -1):
    bm = bmesh.new()
    half = [(R * math.cos(a), R * math.sin(a)) for a in [math.pi * k / 12 for k in range(13)]]
    vs = [bm.verts.new((sx * 0.48, y, H + z)) for y, z in half]
    vs2 = [bm.verts.new((sx * 0.52, y, H + z)) for y, z in half]
    bm.faces.new(vs)
    bm.faces.new(list(reversed(vs2)))
    for a in range(len(vs) - 1):
        bm.faces.new((vs[a], vs[a + 1], vs2[a + 1], vs2[a]))
    bm.faces.new((vs[-1], vs[0], vs2[0], vs2[-1]))
    m = bpy.data.meshes.new('end')
    bm.to_mesh(m)
    bm.free()
    m.transform(Matrix.Translation(-HINGE))
    o = bpy.data.objects.new('end', m)
    scene.collection.objects.link(o)
    o.parent = pivot
    rigid(o, 'PASSIVE', 'CONVEX_HULL')
    o.rigid_body.kinematic = True
    o.hide_render = True
    staves.append(o)

# The lid's swing, as the app had it: flung open, overshooting, settling (three's hinge angle,
# negative opening; Blender's the other way round its x)
OPEN = -1.92
lid_angle = []
ang, vel = 0.0, 0.0
# The frame everything's let go: not before the third (Blender's first step can't move a held body
# fast enough to hand its speed on), and the lid's thrown with it
BURST = 3
HOLD_SHUT = BURST
for f in range(FRAMES):
    if f == HOLD_SHUT:
        vel = -11.0
    if f >= HOLD_SHUT:
        for _ in range(10):
            dt = 1 / (SIM_FPS * 10)
            vel += (140 * (OPEN - ang) - 10 * vel) * dt
            ang += vel * dt
    lid_angle.append(ang)
for f in range(FRAMES):
    pivot.rotation_euler = (-lid_angle[f], 0, 0)
    pivot.keyframe_insert('rotation_euler', frame=f + 1)

print('chains')
link_shape = link_mesh()
links = []  # (object, chain, distance from the padlock)
chains = []
# Two belts round the chest: the upper one's ends held by the padlock's shackle, the lower one's
# meeting at the front, where it's broken (not joined): the blast throws both open from the front
BELTS = ((0.44, 0.1, 'upper'), (0.19, 0.03, 'lower'))
for z, gap, name in BELTS:
    belt, _ = chain_links(belt_path(z, gap), 0.016, 0.03)
    d = [gap + i * LINK for i in range(len(belt))]
    # Each way round from the front, whichever's shorter: how far the glow has to run to it
    total = d[-1] + gap
    chains.append((name, belt, [min(x, total - x + gap) + (0.25 if name == 'lower' else 0) for x in d]))

link_objs = []
for name, chain, dists in chains:
    objs = []
    for k, ((at, rot, _n), dist) in enumerate(zip(chain, dists)):
        m = link_shape[0].copy()
        o = bpy.data.objects.new(f'link_{name}_{k}', m)
        scene.collection.objects.link(o)
        o.matrix_world = Matrix.Translation(at) @ rot.to_4x4()
        rigid(o, mass=0.03, friction=0.6, bounce=0.12)
        # Heavier in the air than one link alone: the chain drags
        o.rigid_body.linear_damping = 0.2
        # Thrown hardest nearest the padlock, out toward the camera and away from the middle; the
        # sides pushed out; the back barely
        at, _rot, n = chain[k]
        near = math.exp(-max(0.0, dist - 0.1) / 0.45)
        power = 1.0 if name == 'upper' else 0.75
        if n.y > 0.7:
            v = Vector((math.copysign(2.6, at.x) * (0.3 + near), 4.2 * (0.3 + near), 2.6 + 2.6 * near)) * power
        elif n.y < -0.7:
            v = Vector((0, -0.4, 1.0)) * power
        else:
            v = Vector((math.copysign(1.6, at.x), 1.1, 1.8)) * power
        v += Vector((rnd.uniform(-0.25, 0.25), rnd.uniform(-0.25, 0.25), rnd.uniform(-0.2, 0.2)))
        launch(o, v, spin_of(0, 6), BURST)
        objs.append(o)
        links.append((o, dist))
    # Each link joined to the next where they hook, but for one at each corner: the belts come
    # apart in four lengths, front, back and sides, and each goes its own way
    def face(n):
        return ('x+' if n.x > 0 else 'x-') if abs(n.x) > abs(n.y) else ('y+' if n.y > 0 else 'y-')

    for (a, b), na, nb in zip(zip(objs, objs[1:]), [c[2] for c in chain], [c[2] for c in chain[1:]]):
        if face(na) != face(nb):
            continue
        e = bpy.data.objects.new('joint', None)
        scene.collection.objects.link(e)
        e.location = (a.matrix_world.translation + b.matrix_world.translation) / 2
        bpy.ops.object.select_all(action='DESELECT')
        bpy.context.view_layer.objects.active = e
        bpy.ops.rigidbody.constraint_add(type='POINT')
        e.rigid_body_constraint.object1 = a
        e.rigid_body_constraint.object2 = b
        e.rigid_body_constraint.disable_collisions = True
    link_objs.append(objs)

print('padlock')
lock_bm = join(padlock_parts())
lock_centre = Vector((0, LOCK_Y, LOCK_Z))
pieces = fracture(lock_bm, 3, [], lock_centre)
lock_objs = []
lock_info = []
for i, (b, planes) in enumerate(pieces):
    o, shape = obj_from(to_mesh(b), f'lock{i}')
    rigid(o, mass=0.06, friction=0.5, bounce=0.3)
    out_dir = (o.location - lock_centre)
    out_dir = Vector((out_dir.x, 0, out_dir.z)).normalized() if out_dir.length > 1e-4 else Vector((0, 0, 1))
    v = (out_dir * 1.4 + Vector((0, 1, 0)) * 1.0).normalized() * rnd.uniform(4.0, 6.5) + Vector((0, 0, 2.6))
    launch(o, v, spin_of(9, 22), BURST)
    lock_objs.append((o, shape))
    lock_info.append({
        'rest': three(o.location),
        # The planes it was cut along, in three's axes: a point on each and the way out of the piece
        'planes': [three(co) + three(no) for co, no in planes],
    })
shackles = []
for i, (m, cols, kinds) in enumerate(shackle_halves()):
    o, shape = obj_from((m, cols, kinds), f'shackle{i}')
    rigid(o, mass=0.04, friction=0.5, bounce=0.3)
    side = 1 if i == 0 else -1
    launch(o, (side * 2.6, 2.4, 4.4), (rnd.uniform(-4, 4), side * 20, rnd.uniform(-6, 6)), BURST)
    shackles.append((o, shape))

print('coins, gems')


# The frame the treasure goes up
ERUPT = 13


def erupt(o, up, out, flip):
    """Up out of the chest, a little out from its middle, tumbling. Kept out of sight below the
    floor until just before (the stacks it waits in would show as the lid comes up)"""
    at = o.location.copy()
    o.rigid_body.kinematic = True
    o.location = at + Vector((0, 0, -20))
    o.keyframe_insert('location', frame=1)
    o.keyframe_insert('location', frame=ERUPT - 3)
    o.location = at
    o.keyframe_insert('location', frame=ERUPT - 2)
    a = math.atan2(o.location.y, o.location.x) + rnd.uniform(-0.6, 0.6)
    h = rnd.uniform(*out)
    v = (math.cos(a) * h, math.sin(a) * h * 0.8 + 0.15, rnd.uniform(*up))
    axis = Vector((math.cos(a + math.pi / 2), math.sin(a + math.pi / 2), rnd.uniform(-0.3, 0.3))).normalized()
    launch(o, v, tuple(axis * rnd.uniform(*flip)), ERUPT)


coin_objs = []
for k in range(48):
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=16, radius1=0.06, radius2=0.06, depth=0.012)
    m = bpy.data.meshes.new('coin')
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(f'coin{k}', m)
    scene.collection.objects.link(o)
    # In layers of eight, none touching (two overlapping would be thrown apart the moment they're let go)
    layer, slot = divmod(k, 8)
    sx = (slot % 4 - 1.5) * 0.18
    sy = ((slot // 4) - 0.5) * 0.16
    o.location = (sx + rnd.uniform(-0.015, 0.015), sy + rnd.uniform(-0.015, 0.015), 0.47 + layer * 0.036)
    o.rotation_euler = (rnd.uniform(-0.12, 0.12), rnd.uniform(-0.12, 0.12), rnd.uniform(0, 6.28))
    rigid(o, shape='CYLINDER', mass=0.012, friction=0.45, bounce=0.35)
    erupt(o, (3.8, 5.4), (0.4, 1.35), (14, 32))
    coin_objs.append(o)
gem_objs = []
for k in range(9):
    # The crown and the point under it, as the app's gem is
    bm = bmesh.new()
    bmesh.ops.create_cone(bm, cap_ends=True, segments=8, radius1=0.05, radius2=0.032, depth=0.022)
    bmesh.ops.translate(bm, vec=(0, 0, 0.011), verts=bm.verts)
    low = bmesh.new()
    bmesh.ops.create_cone(low, cap_ends=True, segments=8, radius1=0.05, radius2=0.0, depth=0.055)
    bmesh.ops.rotate(low, cent=(0, 0, 0), matrix=Matrix.Rotation(math.pi, 3, 'X'), verts=low.verts)
    bmesh.ops.translate(low, vec=(0, 0, -0.0275), verts=low.verts)
    for v in low.verts:
        bm.verts.new(v.co)
    low.free()
    bmesh.ops.convex_hull(bm, input=bm.verts[:])
    m = bpy.data.meshes.new('gem')
    bm.to_mesh(m)
    bm.free()
    o = bpy.data.objects.new(f'gem{k}', m)
    scene.collection.objects.link(o)
    # On top of the coins, three by three
    o.location = ((k % 3 - 1) * 0.2 + rnd.uniform(-0.02, 0.02), (k // 3 - 1) * 0.12, 0.73 + rnd.uniform(0, 0.02))
    o.rotation_euler = (rnd.uniform(-0.2, 0.2), rnd.uniform(-0.2, 0.2), rnd.uniform(0, 6.28))
    rigid(o, mass=0.02, friction=0.4, bounce=0.4)
    erupt(o, (3.6, 4.8), (0.3, 1.0), (8, 18))
    gem_objs.append(o)

# ---- A look at it, from where the app's camera is (set up before the run: added after it, the
# objects would throw away what's been simulated) ----
PREVIEW_FRAMES = tuple(int(x) for x in os.environ.get('PREVIEW_FRAMES', '1,3,5,8,11,15,20,26,34,44,60,80,110,150,181').split(','))


def setup_preview():
    os.makedirs(PREVIEW, exist_ok=True)
    # The chest's visible parts, the lid on the pivot
    for name, pieces_ in (('body', M.body), ('treasure', M.treasure), ('dais', M.dais)):
        for j, (m, _c, _k) in enumerate(pieces_):
            o = bpy.data.objects.new(f'{name}{j}', m)
            scene.collection.objects.link(o)
            o.color = (0.55, 0.33, 0.16, 1) if name == 'body' else (0.25, 0.2, 0.45, 1) if name == 'dais' else (0.9, 0.7, 0.2, 1)
    for j, (m, _c, _k) in enumerate(M.lid):
        o = bpy.data.objects.new(f'lid{j}', m)
        scene.collection.objects.link(o)
        o.parent = pivot
        o.matrix_parent_inverse = Matrix.Translation(-HINGE)
        o.color = (0.6, 0.38, 0.18, 1)
    for o, _ in links:
        o.color = (0.25, 0.25, 0.3, 1)
    for o, _ in lock_objs + shackles:
        o.color = (0.85, 0.65, 0.2, 1)
    for o in coin_objs:
        o.color = (1, 0.8, 0.2, 1)
    for o in gem_objs:
        o.color = (0.7, 0.3, 1, 1)
    scene.render.engine = 'BLENDER_WORKBENCH'
    scene.display.shading.light = 'STUDIO'
    scene.display.shading.color_type = 'OBJECT'
    scene.display.shading.show_shadows = True
    scene.render.resolution_x = 300
    scene.render.resolution_y = 650
    cam_data = bpy.data.cameras.new('cam')
    cam_data.sensor_fit = 'VERTICAL'
    cam_data.angle = math.radians(34)
    cam = bpy.data.objects.new('cam', cam_data)
    scene.collection.objects.link(cam)
    d = 1.0 / (math.tan(math.radians(17)) * 0.46)
    target = Vector((0, 0, 0.8))
    cam.location = Vector((0, d * math.cos(0.25), 0.8 + d * math.sin(0.25)))
    cam.rotation_euler = (target - cam.location).to_track_quat('-Z', 'Y').to_euler()
    scene.camera = cam


if PREVIEW:
    setup_preview()

# ---- Run it, recording every body each frame ----

bodies = (
    [(o, 'link') for o, _ in links]
    + [(o, 'lock') for o, _ in lock_objs]
    + [(o, 'shackle') for o, _ in shackles]
    + [(o, 'coin') for o in coin_objs]
    + [(o, 'gem') for o in gem_objs]
)
print('simulating', len(bodies), 'bodies,', FRAMES, 'frames')
C = Matrix(((-1, 0, 0), (0, 0, 1), (0, 1, 0)))  # Blender's axes to three's
track = np.zeros((FRAMES, len(bodies), 7), np.float64)
for f in range(FRAMES):
    scene.frame_set(f + 1)
    for i, (o, _) in enumerate(bodies):
        mw = o.matrix_world
        p = C @ mw.translation
        q = (C @ mw.to_3x3().normalized() @ C.transposed()).to_quaternion()
        track[f, i, :3] = p
        track[f, i, 3:] = (q.w, q.x, q.y, q.z)
    if f % 30 == 0:
        print('  frame', f)
    if PREVIEW and f + 1 in PREVIEW_FRAMES:
        scene.render.filepath = os.path.join(PREVIEW, f'f{f + 1:03d}.png')
        bpy.ops.render.render(write_still=True)

# Quaternions kept on one side, frame to frame, so they blend the short way round
for f in range(1, FRAMES):
    flip = np.sum(track[f, :, 3:] * track[f - 1, :, 3:], axis=1) < 0
    track[f, flip, 3:] *= -1

# ---- The knocks: where a body's speed jumps ----
dt = 1 / SIM_FPS
vel = np.gradient(track[:, :, :3], dt, axis=0)
acc = np.linalg.norm(np.diff(vel, axis=0), axis=2)
events = []
last = {}
for f in range(2, FRAMES - 1):
    for i, (o, kind) in enumerate(bodies):
        # Not the blast or the geyser itself
        if f <= BURST + 2 or (kind in ('coin', 'gem') and f <= ERUPT + 2):
            continue
        hit = acc[f, i]
        # A knock: the speed changing by more than gravity would in a frame, a good deal more
        if hit > 1.2 and f - last.get(i, -99) > 6:
            last[i] = f
            p = track[f, i, :3]
            events.append([round(f / SIM_FPS, 3), kind, round(float(min(hit, 8.0)), 2)] + [round(float(v), 3) for v in p])
events.sort(key=lambda e: e[0])
print('knocks', len(events))

# ---- Write ----
step = SIM_FPS // FPS
kept = track[::step]
pos = np.clip(np.round(kept[:, :, :3] * 3000), -32767, 32767).astype(np.int16)
rot = np.clip(np.round(kept[:, :, 3:] * 32767), -32767, 32767).astype(np.int16)
packed = np.concatenate([pos, rot], axis=2)  # frames x bodies x 7


def group(kind):
    idx = [i for i, (_, k) in enumerate(bodies) if k == kind]
    return base64.b64encode(np.ascontiguousarray(packed[:, idx, :]).tobytes()).decode(), len(idx)


def shape_of(objshape):
    o, (m, cols, kinds) = objshape
    return M.pack([(m, cols, kinds)])


print('packing shapes')
link_packed = M.pack([link_shape])
out = {
    'fps': FPS,
    'frames': kept.shape[0],
    'motion': {},
    'lid': [round(a, 4) for a in lid_angle[::step]],
    'knocks': events,
    'link': link_packed,
    'linkGlow': [round(d, 3) for _, d in links],
    'lock': [dict(shape_of(ls), **info) for ls, info in zip(lock_objs, lock_info)],
    'shackle': [dict(shape_of(s), rest=three(s[0].location)) for s in shackles],
    'lockCentre': three(lock_centre),
    # When it all goes, and when the treasure goes up, in seconds from the start of the motion
    'burst': (BURST - 1) / SIM_FPS,
    'erupt': (ERUPT - 1) / SIM_FPS,
}
for kind in ('link', 'lock', 'shackle', 'coin', 'gem'):
    data, n = group(kind)
    out['motion'][kind] = {'n': n, 'data': data}
path = os.path.join(OUT, 'burst.json')
with open(path, 'w') as fh:
    json.dump(out, fh, separators=(',', ':'))
print('wrote', path, os.path.getsize(path) // 1024, 'KB')
