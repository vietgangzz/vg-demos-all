"""
Rothenburg ob der Tauber on Christmas Eve, in paper: tall half-timbered houses shoulder to
shoulder along crooked lanes, roofs deep in snow, every window lit. The market square with its tree
and its Christmas market, the town hall's tower, St. Jakob's two spires, the Plönlein fork with its
little yellow house between two old gate towers. Out from the old town it thins as it goes, the way
a town does: houses further apart along the roads, then farms, fields with fences, woods, the roads
running on out into the snow.

The red house on the square is where Santa lands: the living room (xmas_room.py) is inside it,
its window looking out on the square, its flue going up into the chimney (xmas_hero.py has how).

The houses near the square are made with every detail (they're the ones you see up close); further
out there's less on each, and it bakes into its own maps, so the whole town stays light enough.

  Blender -b -P scripts/blender/xmas_town.py -- preview <out.png> [aerial|roof|square|street]
  Blender -b -P scripts/blender/xmas_town.py -- bake <out dir>

Blender axes: x east, y north, z up. Metres; the red house sits at the origin, its front to the
square (south, -y).
"""

import math
import os
import random
import sys

import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xmas_hero as HERO  # noqa: E402
import xmas_kit as K  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['preview', '/tmp/town.png']
MODE, OUT = args[0], args[1]
VIEW = args[2] if len(args) > 2 else 'aerial'
rnd = random.Random(12)

K.reset()
scene = bpy.context.scene

# ---- Materials ----


def darker_(c, k=0.85):
    v = K.rgb(c)
    return '#' + ''.join(f'{int(x * k * 255):02X}' for x in v[:3])


SNOW = K.paper('snow', '#EEF3FF', fiber=0.06)
SNOW_SHADE = K.paper('snow_shade', '#DCE6FA', fiber=0.06)
PATH = K.paper('path', '#C9D2E6', fiber=0.08, pattern=K.dots('#C9D2E6', '#B9C3DA', 14.0, 0.3))
COBBLE = K.paper('cobble', '#9C97A3', pattern=K.bricks('#A39EAA', '#8E8996', '#C9CDDA', 6.0))
EDGE = K.paper('edge', '#F6EFE2', fiber=0.15)
TIMBER = K.paper('timber', '#6A4330', rough=0.8)
TIMBER_RED = K.paper('timber_red', '#8E3A2B', rough=0.8)
TIMBER_GREY = K.paper('timber_grey', '#5B5F6E', rough=0.8)
TIMBERS = [TIMBER, TIMBER, TIMBER_RED, TIMBER_GREY]
WINDOW = K.glow('window', '#FFC56A', 12.0)
WINDOW_DIM = K.glow('window_dim', '#FF9F4A', 2.6)
SHOP = K.glow('shop', '#FFD08A', 9.0)
FRAME = K.paper('frame', '#FBF6EC')
BRICK = K.paper('brick', '#9C4A35', pattern=K.bricks('#9C4A35', '#B05A40', '#E3D2BE', 9.0))
SOOT = K.paper('soot', '#140D0A', rough=1.0)
DOOR = K.paper('door', '#5B3521', pattern=K.stripes(['#5B3521', '#4C2C1B'], 30.0, 'X'))
DOOR_GREEN = K.paper('door_green', '#2F5A47', pattern=K.stripes(['#2F5A47', '#264B3B'], 30.0, 'X'))
DOORS = [DOOR, DOOR_GREEN] + [K.paper(f'door_{k}', c, pattern=K.stripes([c, darker_(c)], 30.0, 'X'))
                              for k, c in enumerate(['#A7303A', '#2F5C8E', '#7A4E8C', '#C98A2E'])]
GREEN = K.paper('green', '#2D6A4B')
GREEN_LIGHT = K.paper('green_light', '#3D8259')
EDGE_GREEN = K.paper('edge_green', '#D3E6C9', fiber=0.15)
RED = K.paper('red', '#C42A3A')
WHITE = K.paper('white', '#FAF6EE')
GOLD = K.paper('gold', '#E1B24A', rough=0.35, metal=0.7)
IRON = K.paper('iron', '#262224', rough=0.6, metal=0.4)
INK = K.paper('ink', '#231A18')
CARROT = K.paper('carrot', '#F07A2A')
STONE = K.paper('stone', '#A7A1A6', pattern=K.bricks('#A7A1A6', '#9A949A', '#CFCAD0', 5.0))
STONE_WARM = K.paper('stone_warm', '#B7A58E', pattern=K.bricks('#B7A58E', '#A8967F', '#D8CBB8', 4.0))
PLASTER = K.paper('plaster', '#F2EBDD')
LAMP = K.glow('lamp', '#FFD08A', 9.0)
ICE = K.paper('ice', '#DDEBFF', rough=0.2)
STAINED = [K.glow('stained_a', '#FF6B5A', 4.0), K.glow('stained_b', '#5AB4FF', 4.0), K.glow('stained_c', '#FFD45A', 4.0)]
# Rothenburg's colours: ochre, cream, rose, sage, butter yellow, pale blue, terracotta
WALL_COLOURS = ['#E8AE4A', '#D97B68', '#F0D9A6', '#86B4CC', '#E796A6', '#9EC489', '#F0B98C', '#BE9CCB', '#E8845A', '#F4E4BC',
                '#6FAAA2', '#D5564E', '#F2CF5B', '#9DB7E0']
WALLS = [K.paper(f'wall_{k}', c) for k, c in enumerate(WALL_COLOURS)]


def darker(c, k=0.82):
    v = K.rgb(c)
    return '#' + ''.join(f'{int(x * k * 255):02X}' for x in v[:3])


# Tiles, bright the way glazed tiles and fresh paint are on a Christmas card: terracotta and red
# mostly, then teal, blue, plum, green, orange
ROOF_COLOURS = ['#D4593A', '#C9403A', '#E3793F', '#2E9196', '#4F79B8', '#93508F', '#3F9460', '#D4593A', '#B8452F', '#E39A3B']
# Plain colour: the app lays every tile on them itself (xmas_kit.tile_coords), sharper than a map could
ROOFS = [K.paper(f'roof_{k}', c) for k, c in enumerate(ROOF_COLOURS)]
RIDGE_TILE = [K.paper(f'ridge_{k}', darker(c, 0.9)) for k, c in enumerate(ROOF_COLOURS)]
# Barge boards and fascias painted cream, the way they are on the old houses: a light edge to every
# roof, never a dark line
TRIM = [K.paper(f'trim_{k}', '#F4ECDC') for k, c in enumerate(ROOF_COLOURS)]
WOOD = K.paper('wood', '#6B4429', rough=0.8)
COPPER = K.paper('copper', '#8DB5A8', rough=0.5, metal=0.3)
FIR = [K.paper('fir_a', '#2E6B4C'), K.paper('fir_b', '#3A8058'), K.paper('fir_c', '#276046')]
BARK = K.paper('bark', '#4A3428', rough=0.95)
FAIRY = K.glow('fairy', '#FFD38A', 14.0)
SHUTTERS = [K.paper('shutter_g', '#2D6A4B'), K.paper('shutter_r', '#A8323F'), K.paper('shutter_b', '#3C5E9C'), K.paper('shutter_o', '#B7832F'),
            K.paper('shutter_t', '#2E8C8A'), K.paper('shutter_w', '#F4EEE2'), K.paper('shutter_m', '#B4467C')]
# Paper stars lit from inside, hanging in the windows (the Moravian star, in every window in Franconia)
STAR_COLOURS = ['#FF5A4E', '#FFF1D6', '#FFD45A', '#FF5A4E']
STARS = [K.glow(f'win_star_{k}', c, 9.0) for k, c in enumerate(STAR_COLOURS)]
# Each window star: (object, colour, size); exported, and drawn in the app (too small to bake)
win_stars = []
BERRY = K.paper('berry', '#D2283B', rough=0.4)
BULB_COLOURS = ['#FFC46B', '#FF5B5B', '#6CFF93', '#6FB8FF', '#FFD9F2']
BULBS = []
for k, c in enumerate(BULB_COLOURS):
    m = K.glow(f'bulb_{k}', c, 30.0)
    m['light_group'] = 'tree'
    BULBS.append(m)
STAR_GLOW = K.glow('star_glow', '#FFE7A0', 30.0)
STAR_GLOW['light_group'] = 'tree'
bulbs = []
chimneys = []
lanterns = []
marks = {}

# ---- How detailed a thing is: by how close it is to the square, where you see it from ----

SQUARE = (0.0, -19.0)


def deco(group):
    """Small dressing (garlands, wreaths, stars, strings of lights) bakes into its own maps, so the
    houses' maps keep their detail: thousands of little pieces would crowd them out"""
    return 'deco' if group in ('core', 'town') else group


def near(x, y):
    """The detail group (and level) a thing at x, y goes in"""
    d = math.hypot(x - SQUARE[0], y - SQUARE[1])
    if d < 34:
        return 'core', 2
    if d < 70:
        return 'town', 1
    return 'outer', 0


# ---- Ground ----

WALL_R = 98.0
SIZE, N = 320.0, 160


def edge_r(a):
    """How far the town reaches out, by direction: not a circle, further along the roads"""
    return 74 + 14 * math.sin(3 * a + 0.7) + 8 * math.sin(5 * a + 2.0) + 5 * math.sin(9 * a)


def townness(x, y):
    """1 in the old town, thinning out to 0 past its edge"""
    a = math.atan2(y, x)
    r = math.hypot(x, y)
    e = edge_r(a)
    k = min(1.0, max(0.0, (r - (e - 14)) / 40.0))
    return 1 - k * k * (3 - 2 * k)


def ground_z(x, y):
    """
    Cobbles under snow, barely rolling, the old town a little up on its hill; fields outside in long
    gentle swells, settling back to the globe's level at the edge so the town sits down into it.
    Keep in step with townGround in world.ts.
    """
    r = math.hypot(x, y)
    rise = 0.35 * math.exp(-((r - 60) / 30.0) ** 2)
    swell = 1.4 * math.sin(x * 0.045 + 0.6) * math.sin(y * 0.052 + 1.1)
    out = min(1.0, max(0.0, (r - 70) / 40.0)) * (1 - min(1.0, max(0.0, (r - 125) / 25.0)))
    return 0.15 * math.sin(x * 0.35) * math.sin(y * 0.31) + rise + swell * out


bm = __import__('bmesh').new()
grid = []
for j in range(N + 1):
    row = []
    for i in range(N + 1):
        x = -SIZE / 2 + SIZE * i / N
        y = -SIZE / 2 + SIZE * j / N
        row.append(bm.verts.new((x, y, ground_z(x, y))))
    grid.append(row)
for j in range(N):
    for i in range(N):
        f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
        f.smooth = True
ground = K.mesh_obj('ground', bm, [SNOW], group='outer')

# ---- The plan: streets, the square, the wall ----


def poly(points, step=2.0):
    """A polyline resampled every `step` metres"""
    out = [Vector((points[0][0], points[0][1]))]
    for a, b in zip(points[:-1], points[1:]):
        a, b = Vector(a), Vector(b)
        n = max(1, int((b - a).length / step))
        for k in range(1, n + 1):
            out.append(a.lerp(b, k / n))
    return out


# Each: (points, width)
STREETS = {
    # West to the castle garden
    'herrngasse': ([(-17, -33.5), (-40, -35), (-62, -37), (-84, -40), (-96, -42), (-120, -50), (-148, -56)], 9.0),
    # South, down to the Plönlein
    'schmiedgasse': ([(3, -35), (4, -48), (1, -62), (-3, -74)], 6.5),
    # The two ways at the Plönlein: up to the Sieber tower, down to the Kobolzell gate
    'sieber': ([(-3, -74), (-10, -84), (-16, -95), (-26, -118), (-36, -146)], 5.0),
    'kobolzell': ([(-3, -74), (2, -86), (6, -97), (13, -122), (19, -148)], 5.0),
    # East to the Röder gate, under the Markus tower
    'hafengasse': ([(17, -5.5), (34, -6), (52, -8), (74, -8), (97, -8), (122, -4), (148, 2)], 7.0),
    # North past the red house to St. Jakob and the Klingen gate
    'klingengasse': ([(-13.2, -6), (-13.5, 12), (-14, 30), (-11, 52), (-8, 74), (-6, 97), (-2, 122), (4, 148)], 6.0),
    # A lane behind the houses on the east of the square
    'lane_e': ([(13.5, -5), (15, 14), (16, 32), (22, 56)], 4.5),
    # Round the inside of the wall, the way the old lanes go
    'ring_w': ([(-62, -37), (-64, 6), (-55, 36), (-36, 62), (-11, 52)], 4.5),
    'ring_e': ([(52, -11), (60, 18), (48, 46), (22, 56), (-8, 74)], 4.5),
    'ring_s': ([(-40, -35), (-36, -56), (-16, -76), (-10, -84)], 4.0),
    'ring_se': ([(34, -6), (36, -44), (22, -70), (2, -86)], 4.0),
}
SQUARE_BOX = (-17.0, 17.0, -35.0, -4.2)


def street_dist(x, y):
    """How far x, y is from the nearest street's edge (negative: on it)"""
    best = 1e9
    p = Vector((x, y))
    for pts, w in STREETS.values():
        for a, b in zip(pts[:-1], pts[1:]):
            a, b = Vector(a), Vector(b)
            ab = b - a
            t = max(0.0, min(1.0, (p - a).dot(ab) / ab.length_squared))
            best = min(best, (p - (a + ab * t)).length - w / 2)
    x0, x1, y0, y1 = SQUARE_BOX
    dx = max(x0 - x, 0, x - x1)
    dy = max(y0 - y, 0, y - y1)
    inside = dx == 0 and dy == 0
    sq = -min(x - x0, x1 - x, y - y0, y1 - y) if inside else math.hypot(dx, dy)
    return min(best, sq)


# Trodden snow down the middle of every street
for name, (pts, w) in STREETS.items():
    path = poly(pts, 3.0)
    for a, b in zip(path[:-1], path[1:]):
        mid = (a + b) / 2
        L = (b - a).length
        grp, _ = near(mid.x, mid.y)
        K.box('lane', (L + 0.5, w * 0.62, 0.04), PATH, at=(mid.x, mid.y, ground_z(mid.x, mid.y) + 0.02),
              rot=(0, 0, math.atan2(b.y - a.y, b.x - a.x)), bevel=0, group=grp)
# (The square was once patched with cleared cobbles; from above they read as rugs. The draws stay, so
# everything placed after keeps its place.)
for i in range(9):
    for j in range(7):
        if math.hypot(-14 + i * 3.5 - SQUARE[0], -32 + j * 4.0 - SQUARE[1]) >= 5:
            rnd.random()

# ---- Houses ----

footprints = []


def overlaps(cx, cy, hw, hd, rot, pad=0.25):
    """Separating axes against every house already standing"""
    def corners(cx, cy, hw, hd, rot):
        c, s = math.cos(rot), math.sin(rot)
        return [Vector((cx + c * u - s * v, cy + s * u + c * v)) for u, v in ((-hw, -hd), (hw, -hd), (hw, hd), (-hw, hd))]
    mine = corners(cx, cy, hw + pad, hd + pad, rot)
    for f in footprints:
        if math.hypot(f[0] - cx, f[1] - cy) > hw + hd + f[2] + f[3] + 1:
            continue
        theirs = corners(*f)
        sep = False
        for poly_ in (mine, theirs):
            for a, b in zip(poly_, poly_[1:] + poly_[:1]):
                axis = Vector((-(b - a).y, (b - a).x))
                p1 = [axis.dot(v) for v in mine]
                p2 = [axis.dot(v) for v in theirs]
                if max(p1) < min(p2) or max(p2) < min(p1):
                    sep = True
                    break
            if sep:
                break
        if not sep:
            return True
    return False


def window(cx, cy, z, face_rot, w=0.62, h=0.82, lit=True, shutter=None, group='static', detail=2, spill=False, box=False):
    """A lit window on a wall: glass, a frame and a cross, a snowy sill; shutters and a box of greens close up"""
    nx, ny = math.cos(face_rot), math.sin(face_rot)
    tx, ty = -ny, nx
    at = lambda u, v, d: (cx + tx * u + nx * d, cy + ty * u + ny * d, z + v)  # noqa: E731
    rot = (0, 0, face_rot - math.pi / 2)
    K.box('glass', (w, 0.04, h), WINDOW if lit else WINDOW_DIM, at=at(0, 0, 0.0), rot=rot, bevel=0, group=group)
    if detail >= 1:
        bars = ((0, h / 2 + 0.04, w + 0.16, 0.08), (0, -h / 2 - 0.04, w + 0.2, 0.08), (-w / 2 - 0.04, 0, 0.08, h + 0.1),
                (w / 2 + 0.04, 0, 0.08, h + 0.1))
        if detail >= 2:
            bars += ((0, 0, 0.05, h), (0, 0.02, w, 0.05))
        for u, v, sw, sh in bars:
            K.box('wframe', (sw, 0.06, sh), FRAME, at=at(u, v, 0.03), rot=rot, bevel=0, group=group)
    K.box('sill_snow', (w + 0.24, 0.16, 0.07), SNOW, at=at(0, -h / 2 - 0.1, 0.08), rot=rot, bevel=0.03 if detail >= 2 else 0,
          segments=2, group=group)
    if spill and lit:
        # Light spilling out of the window, warm, down onto the snow
        L = K.light('window_spill', 'AREA', at(0, 0, 0.3), 24, '#FFB766', size=0.9, rot=(math.radians(68), 0, face_rot - math.pi / 2))
        L['light_group'] = 'base'
    if detail >= 2 and shutter is not None:
        for s in (-1, 1):
            K.box('shutter', (w * 0.5, 0.04, h + 0.06), shutter, at=at(s * (w * 0.75 + 0.08), 0, 0.03), rot=rot, bevel=0, group=group)
    if detail >= 2 and box:
        K.box('flowerbox', (w + 0.1, 0.22, 0.16), TIMBER_RED, at=at(0, -h / 2 - 0.2, 0.14), rot=rot, bevel=0, group=group)
        for k in range(4):
            K.ball('box_green', 0.09, GREEN if k % 2 else GREEN_LIGHT, at=at(-w / 2 + 0.1 + k * (w - 0.2) / 3, -h / 2 - 0.08, 0.16),
                   scale=(1.3, 1.0, 0.8), group=deco(group), seg=8)
            K.ball('box_berry', 0.04, BERRY, at=at(-w / 2 + 0.14 + k * (w - 0.2) / 3, -h / 2 - 0.02, 0.26), group=deco(group), seg=6)
    if detail >= 1 and lit and h >= 0.7:
        dress = rnd.random()
        if dress < 0.35:
            # A paper star lit from inside, hanging in the window
            k = rnd.randrange(len(STARS))
            star = K.cut('win_star', K.star_outline(8, min(w, h) * 0.3, min(w, h) * 0.13, rot=rnd.random()), 0.05, STARS[k], None,
                         at=at(0, h * 0.12, 0.09), rot=(math.pi / 2, 0, face_rot - math.pi / 2), group='dynamic')
            win_stars.append((star, STAR_COLOURS[k], min(w, h) * 0.3))
        elif dress < 0.6 and detail >= 2:
            # A candle arch on the sill: an arc of little lights
            for k in range(5):
                a = math.pi * (k + 0.5) / 5
                K.ball('arch_candle', 0.035, LAMP, at=at(-math.cos(a) * w * 0.38, -h / 2 + 0.06 + math.sin(a) * h * 0.35, 0.07),
                       group=deco(group), seg=6)
            K.tube('arch', [at(-math.cos(math.pi * t / 8) * w * 0.4, -h / 2 + 0.02 + math.sin(math.pi * t / 8) * h * 0.37, 0.06)
                            for t in range(9)], 0.018, GOLD, group=deco(group), res=3)


def snow_blanket(name, w, L, thick, eave, group, seed):
    """
    A blanket of snow lying on a slope (local x across, y down the slope toward `eave` = +-1, z up
    off the roof), soft and uneven: deepest in the middle, thinning to the verges, its lower edge
    ragged where it's starting to slide. The underside sits at z = -0.2, where a slab's would.
    """
    from mathutils import noise
    nx, ny = max(6, int(w / 0.22)), max(6, int(L / 0.22))
    bmm = __import__('bmesh').new()
    top, bot = [], []
    for j in range(ny + 1):
        rt, rb = [], []
        for i in range(nx + 1):
            u, v = i / nx, j / ny
            x = -w / 2 + w * u
            y = -L / 2 + L * v
            # Down the slope from the ridge, 0 at the top to 1 at the eave
            down = v if eave > 0 else 1 - v
            if j in (0, ny):
                y += eave * (0.0 if (j == ny) == (eave < 0) else 0.18 * noise.noise(Vector((x * 0.9, seed, 0.3))))
            edge = min(u, 1 - u) * w
            fall = min(1.0, edge / 0.45) ** 0.6 * (0.55 + 0.45 * math.sin(math.pi * min(1.0, down * 1.05 + 0.08)))
            n = noise.noise(Vector((x * 0.55 + seed, y * 0.55, 0.0)))
            bump = noise.noise(Vector((x * 2.2, y * 2.2 + seed, 1.7))) * 0.035
            z = -0.2 + max(0.03, thick * fall * (0.85 + 0.3 * n) + bump)
            rt.append(bmm.verts.new((x, y, z)))
            rb.append(bmm.verts.new((x, y, -0.2)))
        top.append(rt)
        bot.append(rb)
    for j in range(ny):
        for i in range(nx):
            f = bmm.faces.new((top[j][i], top[j][i + 1], top[j + 1][i + 1], top[j + 1][i]))
            f.smooth = True
            bmm.faces.new((bot[j][i], bot[j + 1][i], bot[j + 1][i + 1], bot[j][i + 1]))
    ring = [(0, i) for i in range(nx)] + [(j, nx) for j in range(ny)] + [(ny, i) for i in range(nx, 0, -1)] + [(j, 0) for j in range(ny, 0, -1)]
    for (j0, i0), (j1, i1) in zip(ring, ring[1:] + ring[:1]):
        f = bmm.faces.new((bot[j0][i0], bot[j1][i1], top[j1][i1], top[j0][i0]))
        f.smooth = True
    __import__('bmesh').ops.recalc_face_normals(bmm, faces=bmm.faces)
    return K.mesh_obj(name, bmm, [SNOW], group)


def gable_outline(rd, rh, over):
    """A gable end's outline (across, up from the eaves), its top following the underside of the roof
    slabs that are laid over it (each 0.14 thick, `over` past the wall at the eave)"""
    s = (rh + 0.3) / (rd / 2 + over)
    under = -0.08 - 0.07 * math.sqrt(1 + s * s) - 0.01
    eave = under + over * s
    return [(-rd / 2, 0), (rd / 2, 0), (rd / 2, max(0.0, eave)), (0, rh + 0.3 + under), (-rd / 2, max(0.0, eave))]


def roof_slab(size, mat, edge, **kw):
    """A slope of the roof: tiles on top; its edges and underside painted like the trim, so from any
    side the roof's edge reads light, never as a dark line"""
    o = K.box('roof', size, mat, **kw)
    o.data.materials.append(edge)
    for poly in o.data.polygons:
        if poly.normal.z < 0.7:
            poly.material_index = 1
    return o


def snow_roof(parts, w, run, slope, sgn, h, rh, group, detail, thin=False):
    """
    Snow lying on one slope: a slab, a cornice over the eave, lumps, icicles. The tiles show along
    the verges; on a `thin` roof the snow's only lying high up, slid off the warm lower half.
    """
    half = run * math.cos(slope)
    f, length, depth = (0.3, 0.58, 0.18) if thin else (0.5, 0.98, 0.42)
    at = (0, sgn * half * f, h + (rh + 0.3) * (1 - f) + 0.11 - (0.1 if thin else 0))
    if detail >= 2:
        o = snow_blanket('roof_snow', w + (0.2 if thin else 0.45), run * length, depth + 0.12, sgn, group, rnd.random() * 50)
        o.location = at
        o.rotation_euler = (-sgn * slope, 0, 0)
        parts.append(o)
    else:
        parts.append(K.box('roof_snow', (w + (0.2 if thin else 0.45), run * length, depth), SNOW, at=at, rot=(-sgn * slope, 0, 0),
                           bevel=0.14 if detail >= 1 else 0.05, segments=3 if detail >= 1 else 1, group=group))
    if thin:
        return
    # The cornice curling over the eave
    eave_y = sgn * (half + 0.05)
    if detail >= 2:
        n_l = max(2, int((w + 0.4) / 0.55))
        for k in range(n_l):
            lx = -w / 2 - 0.2 + (k + 0.5) * (w + 0.4) / n_l
            parts.append(K.ball('cornice', 0.26 + rnd.random() * 0.08, SNOW, at=(lx, eave_y, h + 0.12 + rnd.random() * 0.05),
                                scale=(1.4, 0.9, 0.62), group=group, seg=8))
        for k in range(int(w * 0.6)):
            u = rnd.uniform(-w / 2, w / 2)
            v = rnd.uniform(0.2, 0.8)
            parts.append(K.ball('snow_lump', 0.22 + rnd.random() * 0.2, SNOW_SHADE if k % 3 == 0 else SNOW,
                                at=(u, sgn * v * half, h + (rh + 0.3) * (1 - v) + 0.2), scale=(1.6, 1.2, 0.45), group=group, seg=8))
        for k in range(int(w * 1.6)):
            L = 0.15 + rnd.random() * 0.45
            ic = K.cyl('icicle', 0.045, L, ICE, at=(-w / 2 + w * (k + 0.5) / int(w * 1.6), sgn * (half - 0.02), h - 0.05), r2=0.0, seg=5,
                       group=group)
            ic.rotation_euler = (math.pi, 0, 0)
            parts.append(ic)
    else:
        parts.append(K.cyl('cornice', 0.22, w + 0.5, SNOW, at=(-w / 2 - 0.25, eave_y, h + 0.12), rot=(0, math.pi / 2, 0), seg=8,
                           group=group))


def timber(parts, w, yy, z0, fh, group, pattern, TIMBER=TIMBER):
    """Half-timbering across one storey of a wall at depth yy: posts, rails and braces"""
    n = max(2, int(w / 1.1))
    for k in range(n + 1):
        xx = -w / 2 + 0.06 + k * (w - 0.12) / n
        parts.append(K.box('post', (0.13, 0.05, fh), TIMBER, at=(xx, yy, z0 + fh / 2), bevel=0, group=group))
    parts.append(K.box('rail', (w, 0.05, 0.12), TIMBER, at=(0, yy, z0 + 0.06), bevel=0, group=group))
    parts.append(K.box('rail', (w, 0.05, 0.1), TIMBER, at=(0, yy, z0 + fh * 0.42), bevel=0, group=group))
    for k in range(n):
        if pattern == 0 and k % 2:
            continue
        cx = -w / 2 + 0.06 + (k + 0.5) * (w - 0.12) / n
        cw = (w - 0.12) / n
        ang = math.atan2(fh * 0.55, cw) * (1 if k % 2 else -1)
        parts.append(K.box('brace', (math.hypot(cw, fh * 0.55) * 0.95, 0.05, 0.09), TIMBER, at=(cx, yy, z0 + fh * 0.7), rot=(0, ang, 0),
                           bevel=0, group=group))
        if pattern == 2:
            parts.append(K.box('brace', (math.hypot(cw, fh * 0.55) * 0.95, 0.05, 0.09), TIMBER, at=(cx, yy, z0 + fh * 0.7), rot=(0, -ang, 0),
                               bevel=0, group=group))


def house(x, y, w, d, floors, rot=0.0, gable=False, wall=None, roof=None, chimney=True, lights=None, sign=False, shop=False,
          timbered=None, pitch=None, group=None, detail=None, spill=None):
    """
    A tall old town house: a stone ground floor, plastered or half-timbered storeys above, each
    jutting out a little over the one below, a steep roof deep in snow. Its front is local -y; with
    `gable` the roof's end faces the street, otherwise its eave does.
    """
    grp, det = near(x, y)
    group = group or grp
    detail = det if detail is None else detail
    if lights is None:
        lights = rnd.random() < (0.9 if detail >= 1 else 0.35)
    if spill is None:
        spill = detail >= 2
    wall_mat = wall or rnd.choice(WALLS)
    roof_mat = roof or rnd.choice(ROOFS)
    timbered = (rnd.random() < 0.6) if timbered is None else timbered
    pitch = pitch or (1.35 if gable else 1.05 + rnd.random() * 0.25)
    # Most roofs have shed their snow from the eaves, the tiles showing below; a few are deep in it
    thin = rnd.random() < 0.8
    beams = rnd.choice(TIMBERS)
    trim = TRIM[ROOFS.index(roof_mat)] if roof_mat in ROOFS else WOOD
    gz = ground_z(x, y)
    pivot = bpy.data.objects.new('house', None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.location = (x, y, gz - 0.05)
    pivot.rotation_euler = (0, 0, rot)
    parts = []
    ground_h = 3.0
    fh = 2.7
    jut = 0.18 if timbered else 0.0
    # The storeys: the ground floor in stone, the rest stepping out over it
    z = 0.0
    ww, dd = w, d
    for f in range(floors):
        hh = ground_h if f == 0 else fh
        mat = STONE_WARM if (f == 0 and timbered) else wall_mat
        parts.append(K.box('storey', (ww, dd, hh), mat, at=(0, 0, z + hh / 2), bevel=0.02 if detail >= 1 else 0, group=group))
        if f > 0 and timbered and detail >= 1:
            pattern = rnd.randrange(3)
            for side in (-1, 1):
                timber(parts, ww, side * (dd / 2 + 0.02), z, hh, group, pattern, beams)
            parts.append(K.box('jetty_beam', (ww + 0.05, dd + 0.05, 0.16), beams, at=(0, 0, z + 0.04), bevel=0, group=group))
        z += hh
        if f < floors - 1 and f > 0 or (f == 0 and timbered):
            ww, dd = ww + jut * (0 if gable else 0) + (jut if gable else 0), dd + jut * 2
    top_w, top_d = ww, dd
    h = z
    # The roof: ridge along local x, or with `gable`, the house is turned so its gable end is the
    # front: the ridge runs back from the street (local y)
    rw, rd = (top_w, top_d) if not gable else (top_d, top_w)
    rh = rd / 2 * pitch
    slope = math.atan2(rh + 0.3, rd / 2 + 0.4)
    run = math.hypot(rd / 2 + 0.4, rh + 0.3)
    roof_parts = []
    gable_mat = wall_mat
    # The gable end, built up to meet the roof's underside: no gap under the roof to see dark through
    roof_parts.append(K.cut('gable', gable_outline(rd, rh, 0.4), rw - 0.02, gable_mat, EDGE, at=(-rw / 2 + 0.01, 0, h),
                            rot=(math.pi / 2, 0, math.pi / 2), group=group))
    for sgn in (-1, 1):
        roof_parts.append(roof_slab((rw + 0.6, run, 0.14), roof_mat, trim, at=(0, sgn * (rd / 2 + 0.4) / 2, h + (rh + 0.3) / 2 - 0.08),
                                    rot=(-sgn * slope, 0, 0), bevel=0.02 if detail >= 1 else 0, group=group))
        snow_roof(roof_parts, rw, run, slope, sgn, h, rh, group, detail, thin=thin)
    roof_parts.append(K.box('ridge_snow', (rw + 0.64, 0.4, 0.3), SNOW, at=(0, 0, h + rh + 0.36), rot=(math.pi / 4, 0, 0),
                            bevel=0.12 if detail >= 1 else 0, segments=3, group=group))
    ridge_mat = RIDGE_TILE[ROOFS.index(roof_mat)] if roof_mat in ROOFS else TIMBER
    roof_parts.append(K.cyl('ridge_cap', 0.13, rw + 0.66, ridge_mat, at=(-rw / 2 - 0.33, 0, h + rh + 0.3), rot=(0, math.pi / 2, 0), seg=8,
                            group=group))
    if detail >= 1:
        for sgn in (-1, 1):
            ey = sgn * (rd / 2 + 0.4)
            roof_parts.append(K.box('fascia', (rw + 0.62, 0.05, 0.2), trim, at=(0, ey, h - 0.06), bevel=0, group=group))
            if detail >= 2:
                roof_parts.append(K.cyl('gutter', 0.07, rw + 0.6, COPPER, at=(-rw / 2 - 0.3, ey + sgn * 0.06, h - 0.1),
                                        rot=(0, math.pi / 2, 0), seg=8, group=group))
                roof_parts.append(K.cyl('downpipe', 0.045, h - 0.1, COPPER, at=(rw / 2 + 0.22, ey + sgn * 0.06 - sgn * 0.3, 0.0), seg=6,
                                        group=group))
            # Barge boards up both verges
            for vx in (-1, 1):
                roof_parts.append(K.box('barge', (0.07, run, 0.24), trim, at=(vx * (rw / 2 + 0.31), sgn * (rd / 2 + 0.4) / 2,
                                        h + (rh + 0.3) / 2 - 0.1), rot=(-sgn * slope, 0, 0), bevel=0, group=group))
    roof_root = bpy.data.objects.new('roof_root', None)
    bpy.context.scene.collection.objects.link(roof_root)
    roof_root.parent = pivot
    roof_root.rotation_euler = (0, 0, math.pi / 2 if gable else 0)
    for o in roof_parts:
        o.parent = roof_root
    # Dormers on the long roof, close up
    if detail >= 1 and not gable and top_w > 5 and rnd.random() < (0.9 if detail >= 2 else 0.5):
        for k in range(1 if top_w < 7 else 2):
            u = (-0.25 + 0.5 * k) * top_w if top_w >= 7 else 0.0
            vy = -(rd / 2 + 0.4) * 0.45
            vz = h + (rh + 0.3) * 0.55
            parts.append(K.box('dormer', (1.1, 1.2, 1.1), wall_mat, at=(u, vy - 0.1, vz + 0.2), bevel=0, group=group))
            parts.append(K.cut('dormer_roof', [(-0.75, 0), (0.75, 0), (0, 0.7)], 1.5, roof_mat, EDGE, at=(u, vy + 0.65, vz + 0.75),
                               rot=(math.pi / 2, 0, 0), group=group))
            parts.append(K.box('dormer_snow', (1.6, 1.4, 0.18), SNOW, at=(u, vy, vz + 1.15), bevel=0.06, segments=2, group=group))
            before = set(bpy.context.scene.objects)
            window(u, vy - 0.72, vz + 0.2, -math.pi / 2, w=0.5, h=0.6, lit=True, group=group, detail=1)
            parts.extend(o for o in bpy.context.scene.objects if o not in before and o.type != 'LIGHT')
    if detail >= 2:
        # Dressed stones up the corners of the ground floor
        for cx_ in (-w / 2, w / 2):
            for k in range(5):
                long_ = k % 2 == 0
                parts.append(K.box('quoin', (0.5 if long_ else 0.3, 0.06, 0.3), STONE, at=(cx_ - math.copysign(0.25 if long_ else 0.15, cx_),
                                   -d / 2 - 0.02, 0.35 + k * 0.55), bevel=0, group=group))
        if floors >= 3 and not gable and rnd.random() < 0.35:
            # An oriel: a little bay of windows jutting out over the street on the first floor
            oz = ground_h + 0.2
            parts.append(K.box('oriel', (1.8, 0.7, 2.2), wall_mat, at=(w * 0.22, -dd / 2 - 0.35, oz + 1.1), bevel=0.02, group=group))
            parts.append(K.box('oriel_base', (1.9, 0.75, 0.25), TIMBER, at=(w * 0.22, -dd / 2 - 0.37, oz), bevel=0.02, group=group))
            parts.append(K.cut('oriel_roof', [(-1.05, 0), (1.05, 0), (0, 0.55)], 0.85, roof_mat, EDGE, at=(w * 0.22, -dd / 2 + 0.05, oz + 2.2),
                               rot=(math.pi / 2, 0, 0), group=group))
            parts.append(K.box('oriel_snow', (2.1, 0.8, 0.14), SNOW, at=(w * 0.22, -dd / 2 - 0.38, oz + 2.62), bevel=0.05, group=group))
            for u in (-0.45, 0.45):
                before = set(bpy.context.scene.objects)
                window(w * 0.22 + u, -dd / 2 - 0.72, oz + 1.15, -math.pi / 2, w=0.5, h=1.1, lit=True, group=group, detail=1)
                parts.extend(o for o in bpy.context.scene.objects if o not in before and o.type != 'LIGHT')
        if rnd.random() < 0.8:
            # A garland of fir along the first floor, red bows where it's caught up
            pts = []
            for k in range(13):
                t = k / 12
                pts.append((-w / 2 + 0.2 + (w - 0.4) * t, -d / 2 - 0.12, ground_h - 0.15 - 0.35 * abs(math.sin(math.pi * t * 2))))
            parts.append(K.tube('facade_garland', pts, 0.08, GREEN, group=deco(group), res=3))
            for k in (0, 3, 6, 9, 12):
                parts.append(K.ball('garland_bow', 0.11, RED, at=pts[k], scale=(1.4, 0.6, 1.0), group=deco(group), seg=8))
            for k in (1, 5, 7, 11):
                parts.append(K.ball('garland_bauble', 0.06, GOLD if k % 2 else BERRY, at=(pts[k][0], pts[k][1] - 0.04, pts[k][2] - 0.12),
                                    group=deco(group), seg=8))
    if detail >= 1 and rnd.random() < 0.5:
        # A little roof over the door, snow on it
        parts.append(K.box('canopy', (1.6, 0.8, 0.08), roof_mat, at=(0, -d / 2 - 0.4, 2.45), rot=(0.3, 0, 0), bevel=0, group=group))
        parts.append(K.box('canopy_snow', (1.62, 0.78, 0.12), SNOW, at=(0, -d / 2 - 0.42, 2.53), rot=(0.3, 0, 0), bevel=0.04, group=group))
        for sx in (-0.7, 0.7):
            parts.append(K.box('canopy_bracket', (0.06, 0.6, 0.06), TIMBER, at=(sx, -d / 2 - 0.3, 2.25), rot=(-0.6, 0, 0), bevel=0, group=group))
    # Windows: rows on the front, fewer on the back, a pair up in the street gable
    def add_window(*a, **kw):
        before = set(bpy.context.scene.objects)
        window(*a, **kw)
        parts.extend(o for o in bpy.context.scene.objects if o not in before and o.type != 'LIGHT')
        for o in bpy.context.scene.objects:
            if o not in before and o.type == 'LIGHT':
                o.parent = pivot

    z = 0.0
    ww, dd = w, d
    flower = rnd.random() < 0.75
    for f in range(floors):
        hh = ground_h if f == 0 else fh
        n = max(1, int(ww / 1.5))
        for k in range(n):
            u = -ww / 2 + (k + 0.5) * ww / n
            if f == 0 and k == n // 2:
                continue
            if f == 0 and shop:
                add_window(u, -dd / 2 - 0.02, z + 1.4, -math.pi / 2, w=1.0, h=1.4, lit=True, group=group, detail=detail, spill=spill)
                continue
            add_window(u, -dd / 2 - 0.02, z + hh * 0.52, -math.pi / 2, lit=rnd.random() < 0.88, shutter=rnd.choice(SHUTTERS + [None]),
                       group=group, detail=detail, spill=spill and f < 2, box=flower and f == 1)
            if detail >= 1:
                add_window(u, dd / 2 + 0.02, z + hh * 0.52, math.pi / 2, lit=rnd.random() < 0.6, group=group, detail=0)
        z += hh
        if f < floors - 1 and f > 0 or (f == 0 and timbered):
            ww, dd = ww + (jut if gable else 0), dd + jut * 2
    if gable:
        for u in (-0.55, 0.55):
            add_window(u, -top_d / 2 - 0.02, h + rh * 0.3, -math.pi / 2, w=0.5, h=0.7, lit=rnd.random() < 0.8, group=group,
                       detail=min(detail, 1))
        add_window(0, -top_d / 2 - 0.02, h + rh * 0.62, -math.pi / 2, w=0.36, h=0.5, lit=True, group=group, detail=0)
    else:
        for sgn in (-1, 1):
            add_window(sgn * (top_w / 2 + 0.02), 0, h + rh * 0.35, 0 if sgn > 0 else math.pi, w=0.5, h=0.6, lit=rnd.random() < 0.7,
                       group=group, detail=0)
    # The door: an arch of stone, a wreath, a lamp beside it
    door_mat = rnd.choice(DOORS)
    parts.append(K.box('door', (1.0, 0.1, 2.0), door_mat, at=(0, -w * 0 - d / 2 - 0.04, 1.0), bevel=0.02 if detail >= 1 else 0, group=group))
    if detail >= 1:
        parts.append(K.box('door_frame', (1.3, 0.08, 2.25), STONE, at=(0, -d / 2 - 0.01, 1.1), bevel=0, group=group))
        parts.append(K.box('step', (1.4, 0.5, 0.2), STONE, at=(0, -d / 2 - 0.3, 0.1), bevel=0, group=group))
        parts.append(K.box('step_snow', (1.42, 0.45, 0.07), SNOW, at=(0, -d / 2 - 0.3, 0.23), bevel=0.02, group=group))
    if detail >= 1:
        parts.append(K.torus('wreath', 0.26, 0.08, GREEN, at=(0, -d / 2 - 0.12, 1.62), rot=(math.pi / 2, 0, 0), group=deco(group), u=20, v=6))
        parts.append(K.ball('wreath_bow', 0.09, RED, at=(0, -d / 2 - 0.18, 1.38), scale=(1.5, 0.6, 1.0), group=deco(group), seg=8))
        if detail >= 2:
            for k in range(6):
                a = k * math.pi / 3 + 0.3
                parts.append(K.ball('wreath_berry', 0.04, BERRY if k % 2 else GOLD,
                                    at=(0.26 * math.cos(a), -d / 2 - 0.2, 1.62 + 0.26 * math.sin(a)), group=deco(group), seg=6))
        parts.append(K.ball('door_lamp', 0.12, LAMP, at=(0.8, -d / 2 - 0.2, 2.3), group=group, seg=8))
    if sign and detail >= 2:
        # A wrought iron sign out over the street
        parts.append(K.box('sign_arm', (0.06, 1.3, 0.06), IRON, at=(-w / 2 + 0.6, -d / 2 - 0.65, 3.6), bevel=0, group=group))
        parts.append(K.tube('sign_scroll', [(-w / 2 + 0.6, -d / 2 - 0.05, 3.2), (-w / 2 + 0.6, -d / 2 - 0.6, 3.45),
                                            (-w / 2 + 0.6, -d / 2 - 1.2, 3.6)], 0.025, IRON, group=group))
        parts.append(K.cut('sign', K.circle_outline(0.38, 20), 0.04, GOLD, EDGE, at=(-w / 2 + 0.6, -d / 2 - 1.0, 3.15),
                           rot=(math.pi / 2, 0, math.pi / 2), group=group))
    if shop and detail >= 1:
        awn = rnd.choice([RED, GREEN, K.paper('awning_s', '#C9A04A')])
        parts.append(K.box('awning', (w * 0.9, 1.1, 0.06), awn, at=(0, -d / 2 - 0.55, 2.75), rot=(0.35, 0, 0), bevel=0, group=group))
        parts.append(K.box('awning_snow', (w * 0.9, 1.05, 0.1), SNOW, at=(0, -d / 2 - 0.55, 2.82), rot=(0.35, 0, 0), bevel=0.03,
                           group=group))
    # Chimneys, smoking
    if chimney:
        for k in range(1 if rnd.random() < 0.7 else 2):
            cw = 0.6
            cx = (0.28 if k == 0 else -0.3) * (top_d if gable else top_w)
            cy = 0.15 * (top_w if gable else top_d) * (1 if k else -1)
            lx, ly = (cy, cx) if gable else (cx, cy)
            ch_h = rh * (1 - abs(cy) / (rd / 2 + 0.4)) + 1.3
            parts.append(K.box('chimney', (cw, cw * 0.8, ch_h + 0.4), BRICK, at=(lx, ly, h + ch_h / 2 - 0.2), bevel=0, group=group))
            parts.append(K.box('chimney_cap', (cw + 0.16, cw * 0.8 + 0.16, 0.14), STONE, at=(lx, ly, h + ch_h + 0.07), bevel=0, group=group))
            parts.append(K.ball('chimney_lump', cw * 0.55, SNOW, at=(lx, ly, h + ch_h + 0.25), scale=(1.2, 1.0, 0.5), group=group, seg=8))
            c, s = math.cos(rot), math.sin(rot)
            chimneys.append(Vector((x + c * lx - s * ly, y + s * lx + c * ly, gz - 0.05 + h + ch_h + 0.3)))
    if lights:
        # A string of lights swagged along the front, under the eave or across the gable
        pts = []
        span = top_w + 0.4
        yy = -top_d / 2 - (0.25 if gable else 0.45)
        for k in range(21):
            t = k / 20
            pts.append((-span / 2 + span * t, yy, h - 0.15 - 0.25 * abs(math.sin(math.pi * t * 3))))
        parts.append(K.tube('eave_string', pts, 0.015, INK, group=deco(group), res=3))
        for k, p in enumerate(pts):
            c = k % len(BULBS)
            b = K.ball(f'bulb_{c}', 0.06, BULBS[c], at=p, group='dynamic', seg=6)
            b.parent = pivot
            bulbs.append((b, BULB_COLOURS[c]))
    for o in parts:
        if o.parent is None:
            o.parent = pivot
    footprints.append((x, y, top_w / 2, top_d / 2, rot))
    return h, rh


def street_houses(name, side, start=0.0, end=1.0, floors=(3, 4), gable_chance=0.5, shop_chance=0.0, sign_chance=0.0):
    """Houses shoulder to shoulder down one side of a street, their fronts to it"""
    pts, sw = STREETS[name]
    path = poly(pts, 0.5)
    total = sum((b - a).length for a, b in zip(path[:-1], path[1:]))
    s = total * start
    while s < total * end:
        w = 5.5 + rnd.random() * 3.0
        d = 9.0 + rnd.random() * 3.0
        at = s + w / 2
        # Point and direction at arc length `at`
        acc = 0.0
        for a, b in zip(path[:-1], path[1:]):
            L = (b - a).length
            if acc + L >= at:
                p = a.lerp(b, (at - acc) / L)
                tangent = (b - a).normalized()
                break
            acc += L
        else:
            break
        normal = Vector((-tangent.y, tangent.x)) * side
        back = sw / 2 + 0.4 + d / 2 + rnd.uniform(-0.2, 0.3)
        c = p + normal * back
        # Front faces the street: local -y points along -normal
        rot = math.atan2(normal.y, normal.x) - math.pi / 2
        s += w + rnd.uniform(0.0, 0.15)
        if math.hypot(c.x, c.y) > 140 or rnd.random() > townness(c.x, c.y) ** 0.6:
            continue
        if overlaps(c.x, c.y, w / 2, d / 2, rot) or street_dist(c.x, c.y) < d / 2 - 0.6:
            continue
        house(c.x, c.y, w, d, rnd.randint(*floors), rot=rot, gable=rnd.random() < gable_chance, shop=rnd.random() < shop_chance,
              sign=rnd.random() < sign_chance)


# ---- The red house: the room's inside it (xmas_hero.py) ----

HW, HD, HH, WT = HERO.HOUSE_W, HERO.HOUSE_D, HERO.HOUSE_H, HERO.WALL


def hero_house():
    """
    Built as a shell round the room: walls with no inside, so from in the room you see the room.
    Its ground floor window is the room's window, cut right through, and its chimney is the
    room's flue come up through the roof.
    """
    g = 'hero'
    red = K.paper('hero_wall', '#C9473F')
    red_dark = K.paper('hero_wall_low', '#B23E37')
    parts = []
    # Walls, each its own slab: front and back across, the ends between
    front = K.box('wall_front', (HW, WT, HH), red, at=(0, -HD / 2 + WT / 2, HH / 2), bevel=0, group=g)
    K.box('wall_back', (HW, WT, HH), red, at=(0, HD / 2 - WT / 2, HH / 2), bevel=0, group=g)
    for s in (-1, 1):
        K.box('wall_end', (WT, HD - 2 * WT, HH), red, at=(s * (HW / 2 - WT / 2), 0, HH / 2), bevel=0, group=g)
    # The room's window, right through the front wall
    wx, wy, wz = HERO.WINDOW_AT
    hole = K.box('hole', (HERO.WIN_W, 1.0, HERO.WIN_H), red, at=(wx, -HD / 2, wz), bevel=0, group='cutter')
    hole.hide_render = True
    mod = front.modifiers.new('window', 'BOOLEAN')
    mod.object = hole
    mod.operation = 'DIFFERENCE'
    # Stone along the bottom, a band between the floors
    K.box('plinth', (HW + 0.12, 0.12, 0.45), STONE, at=(0, -HD / 2 - 0.04, 0.22), bevel=0.02, group=g)
    K.box('band', (HW + 0.1, 0.1, 0.14), red_dark, at=(0, -HD / 2 - 0.03, 3.4), bevel=0.01, group=g)
    # The upper floor half-timbered, front and back
    for side in (-1, 1):
        timber(parts, HW, side * (HD / 2 + 0.02), 3.45, HH - 3.45, g, 1)
    # Window round the room's: deep reveal, stone frame, a sill with snow, shutters thrown open
    for u, v, sw, sh in ((0, HERO.WIN_H / 2 + 0.07, HERO.WIN_W + 0.3, 0.14), (0, -HERO.WIN_H / 2 - 0.07, HERO.WIN_W + 0.4, 0.14),
                         (-HERO.WIN_W / 2 - 0.07, 0, 0.14, HERO.WIN_H + 0.2), (HERO.WIN_W / 2 + 0.07, 0, 0.14, HERO.WIN_H + 0.2)):
        K.box('room_frame', (sw, 0.1, sh), STONE_WARM, at=(wx + u, -HD / 2 - 0.03, wz + v), bevel=0.01, group=g)
    K.box('room_sill', (HERO.WIN_W + 0.5, 0.3, 0.08), STONE_WARM, at=(wx, -HD / 2 - 0.1, wz - HERO.WIN_H / 2 - 0.12), bevel=0.01, group=g)
    K.box('room_sill_snow', (HERO.WIN_W + 0.46, 0.26, 0.08), SNOW, at=(wx, -HD / 2 - 0.12, wz - HERO.WIN_H / 2 - 0.04), bevel=0.03, group=g)
    for s in (-1, 1):
        K.box('room_shutter', (0.06, HERO.WIN_W * 0.5, HERO.WIN_H + 0.05), SHUTTERS[0], at=(wx + s * (HERO.WIN_W / 2 + 0.2), -HD / 2 - 0.3, wz),
              rot=(0, 0, s * 0.35), bevel=0, group=g)
    K.box('room_box', (HERO.WIN_W + 0.3, 0.24, 0.18), TIMBER_RED, at=(wx, -HD / 2 - 0.28, wz - HERO.WIN_H / 2 - 0.28), bevel=0, group=g)
    for k in range(5):
        K.ball('room_box_green', 0.1, GREEN if k % 2 else GREEN_LIGHT,
               at=(wx - HERO.WIN_W / 2 + k * HERO.WIN_W / 4, -HD / 2 - 0.28, wz - HERO.WIN_H / 2 - 0.14), scale=(1.3, 1.0, 0.8), group=g, seg=8)
        K.ball('room_box_berry', 0.035, RED, at=(wx - HERO.WIN_W / 2 + k * HERO.WIN_W / 4 + 0.05, -HD / 2 - 0.36, wz - HERO.WIN_H / 2 - 0.08),
               group=g, seg=6)
    # Warm light from the room out onto the snow
    L = K.light('room_spill', 'AREA', (wx, -HD / 2 - 0.4, wz), 90, '#FFB766', size=1.0, rot=(math.radians(62), 0, 0))
    L['light_group'] = 'base'
    # The other windows: one left of the door downstairs, four across upstairs, the backs
    window(-2.8, -HD / 2 - 0.02, 1.95, -math.pi / 2, lit=True, shutter=SHUTTERS[0], group=g, detail=2, spill=True, box=True)
    for u in (-2.6, -0.85, 0.85, 2.6):
        window(u, -HD / 2 - 0.02, 4.75, -math.pi / 2, lit=True, shutter=SHUTTERS[0], group=g, detail=2, spill=True, box=True)
        window(u, HD / 2 + 0.02, 4.75, math.pi / 2, lit=True, group=g, detail=1)
    window(-2.0, HD / 2 + 0.02, 1.95, math.pi / 2, lit=True, group=g, detail=1)
    # The door, green, a wreath, a lamp each side
    dx = -1.35
    K.box('door', (1.05, 0.12, 2.1), DOOR_GREEN, at=(dx, -HD / 2 - 0.04, 1.05 + 0.1), bevel=0.02, group=g)
    K.box('door_frame', (1.35, 0.08, 2.4), STONE_WARM, at=(dx, -HD / 2 - 0.01, 1.2), bevel=0.01, group=g)
    K.torus('wreath', 0.24, 0.07, GREEN, at=(dx, -HD / 2 - 0.13, 1.8), rot=(math.pi / 2, 0, 0), group=g, u=28, v=8)
    for k in range(8):
        a = 2 * math.pi * k / 8
        K.ball('wreath_berry', 0.03, RED, at=(dx + math.cos(a) * 0.24, -HD / 2 - 0.2, 1.8 + math.sin(a) * 0.24), group=g, seg=6)
    K.ball('wreath_bow', 0.07, RED, at=(dx, -HD / 2 - 0.18, 1.55), group=g, seg=8)
    for s in (-1, 1):
        K.box('door_lamp', (0.2, 0.2, 0.3), LAMP, at=(dx + s * 0.85, -HD / 2 - 0.22, 2.45), bevel=0.01, group=g)
        K.cyl('door_lamp_cap', 0.17, 0.14, IRON, at=(dx + s * 0.85, -HD / 2 - 0.22, 2.6), r2=0.03, seg=4, rot=(0, 0, math.pi / 4), group=g)
    K.box('step', (1.6, 0.6, 0.22), STONE, at=(dx, -HD / 2 - 0.34, 0.11), bevel=0.02, group=g)
    K.box('step_snow', (1.62, 0.55, 0.08), SNOW, at=(dx, -HD / 2 - 0.34, 0.25), bevel=0.03, group=g)
    # The roof: ridge along x, steep, deep in snow
    rh = HD / 2 * HERO.PITCH
    slope = math.atan2(rh + 0.3, HD / 2 + 0.45)
    run = math.hypot(HD / 2 + 0.45, rh + 0.3)
    roof_mat = K.paper('hero_roof', '#3A7F8A')
    K.cut('gable', gable_outline(HD, rh, 0.45), HW - 0.02, red, EDGE, at=(-HW / 2 + 0.01, 0, HH), rot=(math.pi / 2, 0, math.pi / 2),
          group=g)
    roof_parts = []
    for sgn in (-1, 1):
        roof_parts.append(roof_slab((HW + 0.7, run, 0.14), roof_mat, TRIM[0], at=(0, sgn * (HD / 2 + 0.45) / 2, HH + (rh + 0.3) / 2 - 0.08),
                                    rot=(-sgn * slope, 0, 0), bevel=0.02, group=g))
        snow_roof(roof_parts, HW + 0.1, run, slope, sgn, HH, rh, g, 2, thin=True)
        # Cream barge boards up both verges, a fascia along the eave
        for vx in (-1, 1):
            roof_parts.append(K.box('barge', (0.08, run, 0.26), TRIM[0], at=(vx * (HW / 2 + 0.36), sgn * (HD / 2 + 0.45) / 2,
                                    HH + (rh + 0.3) / 2 - 0.1), rot=(-sgn * slope, 0, 0), bevel=0, group=g))
        roof_parts.append(K.box('fascia', (HW + 0.72, 0.05, 0.2), TRIM[0], at=(0, sgn * (HD / 2 + 0.45), HH - 0.06), bevel=0, group=g))
    K.box('ridge_snow', (HW + 0.76, 0.42, 0.3), SNOW, at=(0, 0, HH + rh + 0.36), rot=(math.pi / 4, 0, 0), bevel=0.14, segments=4, group=g)
    # The chimney, over the room's flue: open, dark, the way down
    cx, cy = HERO.CHIMNEY_XY
    top = HERO.CHIMNEY_TOP
    base = HERO.roof_z(cy) - 0.4
    cw, cd = 0.95, 0.75
    # Hollow, its walls round the flue, so you can look right down into it (the app lines it in brick)
    ow, od = HERO.FLUE_W - 0.02, HERO.FLUE_D - 0.01
    h = top - base
    for sx in (-1, 1):
        K.box('chimney', ((cw - ow) / 2, cd, h), BRICK, at=(cx + sx * (ow + cw) / 4, cy, (top + base) / 2), bevel=0, group=g)
        K.box('chimney_cap', ((cw - ow) / 2 + 0.09, cd + 0.18, 0.14), STONE, at=(cx + sx * ((ow + cw) / 4 + 0.045), cy, top + 0.07), bevel=0.02,
              group=g)
        K.box('chimney_snow', ((cw - ow) / 2 + 0.1, cd + 0.22, 0.12), SNOW, at=(cx + sx * ((ow + cw) / 4 + 0.05), cy, top + 0.2), bevel=0.04,
              group=g)
    for sy in (-1, 1):
        K.box('chimney', (ow, (cd - od) / 2, h), BRICK, at=(cx, cy + sy * (od + cd) / 4, (top + base) / 2), bevel=0, group=g)
        K.box('chimney_cap', (ow, (cd - od) / 2 + 0.09, 0.14), STONE, at=(cx, cy + sy * ((od + cd) / 4 + 0.045), top + 0.07), bevel=0, group=g)
        K.box('chimney_snow', (ow, (cd - od) / 2 + 0.1, 0.12), SNOW, at=(cx, cy + sy * ((od + cd) / 4 + 0.05), top + 0.2), bevel=0.04, group=g)
    for sx, sy in ((-1, 0), (1, 0), (0, -1), (0, 1)):
        K.ball('rim_lump', 0.2, SNOW, at=(cx + sx * cw * 0.5, cy + sy * cd * 0.5, top + 0.3),
               scale=(1.6 if sy else 0.7, 0.7 if sy else 1.6, 0.6), group=g, seg=10)
    # Firelight up the flue, for the bake: warm on the inside of the pot
    K.light('flue_glow', 'POINT', (cx, cy, top - 0.6), 6, '#FF8A3D', size=0.1)
    # Lights all along both eaves
    for sgn in (-1, 1):
        pts = []
        for k in range(33):
            t = k / 32
            pts.append((-HW / 2 - 0.25 + (HW + 0.5) * t, sgn * (HD / 2 + 0.55), HH - 0.12 - 0.22 * abs(math.sin(math.pi * t * 4))))
        K.tube('eave_string', pts, 0.015, INK, group=g, res=3)
        for k, p in enumerate(pts):
            c = k % len(BULBS)
            K.ball(f'bulb_{c}', 0.065, BULBS[c], at=p, group='dynamic', seg=8)
            bulbs.append((Vector(p), BULB_COLOURS[c]))
    for o in parts:
        o['group'] = g
    footprints.append((0.0, 0.0, HW / 2 + 0.3, HD / 2 + 0.3, 0.0))
    ridge = HH + rh + 0.55
    chimneys.append(Vector((cx, cy, top + 0.3)))
    return (cx, cy, top + 0.27), ridge


CHIMNEY, RIDGE = hero_house()
print('chimney top', CHIMNEY, 'ridge', RIDGE)

# Its neighbours on the square, shoulder to shoulder
# West: the team stands along its ridge, level with the red house's
house(-HW / 2 - 3.1, 0.2, 6.0, 7.0, 2, wall=WALLS[3], roof=ROOFS[0], timbered=True, lights=True, sign=True, pitch=0.93)
# East: lower, so the sleigh can glide in over it
house(HW / 2 + 3.3, 0.1, 6.4, 7.2, 2, wall=WALLS[1], roof=ROOFS[2], timbered=False, lights=True, shop=True, pitch=0.75)

# ---- The town hall on the west of the square, its tower over the whole town ----

RX, RY = -24.0, -19.0
rz = ground_z(RX, RY)
K.box('rathaus', (12.0, 22.0, 12.0), PLASTER, at=(RX - 2.0, RY, rz + 6.0), bevel=0.04, group='core')
footprints.append((RX - 2.0, RY, 6.5, 11.5, 0.0))
K.cut('rathaus_gable', [(-11.0, 0), (11.0, 0), (0, 10.0)], 12.0, PLASTER, EDGE, at=(RX - 8.0, RY, rz + 12.0),
      rot=(math.pi / 2, 0, math.pi / 2), group='core')
for sgn in (-1, 1):
    roof_slab((12.6, 15.2, 0.2), ROOFS[0], TRIM[0], at=(RX - 2.0, RY + sgn * 5.5, rz + 17.0), rot=(-sgn * 0.74, 0, 0), bevel=0.03,
              group='core')
    # Snow along the upper part of each slope only, its lower edge lumpy: the tiles show below
    K.box('rathaus_roof_snow', (12.7, 6.6, 0.3), SNOW, at=(RX - 2.0, RY + sgn * 2.24, rz + 20.2), rot=(-sgn * 0.74, 0, 0), bevel=0.1,
          group='core')
    for j in range(9):
        K.ball('rathaus_snow_lump', 0.55 + 0.15 * ((j * 7) % 3), SNOW, at=(RX - 7.6 + j * 1.35, RY + sgn * 4.7, rz + 17.95),
               scale=(1.5, 0.9, 0.42), group='core', seg=10)
# Stepped gable to the square
for k in range(6):
    K.box('rathaus_step', (0.6, 20.0 - k * 3.4, 1.7), PLASTER, at=(RX + 4.3, RY, rz + 12.85 + k * 1.7), bevel=0.02, group='core')
    K.box('rathaus_step_snow', (0.7, 20.0 - k * 3.4, 0.2), SNOW, at=(RX + 4.3, RY, rz + 13.8 + k * 1.7), bevel=0.05, group='core')
# Arcade of arches along the ground floor, windows above
for k in range(5):
    yy = RY - 8.0 + k * 4.0
    arch = [(-1.3, 0), (1.3, 0)] + [(1.3 * math.cos(math.pi * j / 10), 2.8 + 1.3 * math.sin(math.pi * j / 10)) for j in range(11)]
    K.cut('arcade', arch, 0.15, SOOT, EDGE, at=(RX + 4.05, yy, rz), rot=(math.pi / 2, 0, math.pi / 2), group='core')
    K.box('arcade_glow', (0.05, 2.0, 2.6), WINDOW_DIM, at=(RX + 3.95, yy, rz + 1.6), bevel=0, group='core')
    for zz in (6.0, 9.4):
        window(RX + 4.05, yy, rz + zz, 0.0, w=1.0, h=1.6, lit=k % 2 == 0, group='core', detail=2, spill=False)
# The tower: square, tall and pale, a gallery up top and a spire
TWX, TWY = RX - 4.0, RY + 6.0
K.box('rathaus_tower', (5.0, 5.0, 34.0), PLASTER, at=(TWX, TWY, rz + 17.0), bevel=0.05, group='core')
for zz in (14.0, 22.0, 28.0):
    for face in range(4):
        a = face * math.pi / 2
        window(TWX + math.cos(a) * 2.52, TWY + math.sin(a) * 2.52, rz + zz, a, w=0.7, h=1.4, lit=zz > 20, group='core', detail=1)
K.box('tower_gallery', (6.2, 6.2, 0.5), STONE, at=(TWX, TWY, rz + 34.2), bevel=0.04, group='core')
for k in range(16):
    a = 2 * math.pi * k / 16
    K.box('gallery_post', (0.15, 0.15, 1.0), IRON, at=(TWX + math.cos(a) * 3.0, TWY + math.sin(a) * 3.0, rz + 34.9), bevel=0, group='core')
K.cyl('tower_lantern', 1.8, 4.0, PLASTER, at=(TWX, TWY, rz + 34.4), seg=8, group='core')
K.cyl('tower_spire', 2.4, 8.0, ROOFS[5], at=(TWX, TWY, rz + 38.4), r2=0.05, seg=8, group='core')
K.cyl('tower_spire_snow', 2.45, 1.6, SNOW, at=(TWX, TWY, rz + 38.4), r2=1.95, seg=8, group='core')
K.ball('tower_knob', 0.4, GOLD, at=(TWX, TWY, rz + 46.6), group='core', seg=12)
K.light('tower_glow', 'POINT', (TWX, TWY, rz + 36.0), 180, '#FFD08A', size=1.0)
marks['rathaus'] = (TWX, TWY, rz + 46.6)

# The clock on the town hall's stepped gable, over the square
K.cut('clock', K.circle_outline(1.2, 40), 0.1, WHITE, EDGE, at=(RX + 4.62, RY, rz + 15.2), rot=(math.pi / 2, 0, math.pi / 2), group='core')
K.box('clock_hand', (0.06, 0.1, 0.9), INK, at=(RX + 4.74, RY, rz + 15.5), bevel=0, group='core')
K.box('clock_hand', (0.06, 0.65, 0.09), INK, at=(RX + 4.74, RY - 0.3, rz + 15.2), bevel=0, group='core')

# ---- The square: the tree, the market, the fountain, lamps ----

TX, TY = SQUARE[0] - 1.0, SQUARE[1] - 2.0
tz = ground_z(TX, TY)
TREE_H = 11.5
for k in range(18):
    t = k / 17
    r = 3.6 * (1 - t) ** 1.05 + 0.3
    z = tz + 1.1 + t * TREE_H
    o = K.cut('town_tree', K.star_outline(11, r, r * 0.65, rot=k * 0.4), 0.08, GREEN if k % 2 else GREEN_LIGHT, EDGE_GREEN, at=(TX, TY, z),
              group='core')
    for v in o.data.vertices:
        dd = Vector((v.co.x, v.co.y)).length
        v.co.z -= (dd / r) ** 2 * r * 0.25
    K.cut('tree_snow', K.star_outline(11, r * 0.75, r * 0.5, rot=k * 0.4), 0.06, SNOW, EDGE, at=(TX, TY, z + 0.07), group='core')
K.cyl('town_tree_trunk', 0.45, 1.6, TIMBER, at=(TX, TY, tz), group='core')
K.box('tree_fence', (3.2, 3.2, 0.5), TIMBER_RED, at=(TX, TY, tz + 0.25), bevel=0.03, group='core')
K.cut('town_star', K.star_outline(5, 1.0, 0.42), 0.15, GOLD, EDGE, at=(TX, TY, tz + TREE_H + 1.7), rot=(math.pi / 2, 0, 0), group='core')
K.ball('town_star_glow', 0.25, STAR_GLOW, at=(TX, TY - 0.15, tz + TREE_H + 1.7), group='dynamic')
STAR = (TX, TY - 0.15, tz + TREE_H + 1.7)
for k in range(220):
    t = k / 219
    a = t * 2 * math.pi * 9
    z = tz + 1.2 + t * TREE_H
    r = (3.6 * max(0.0, 1 - (z - tz - 1.1) / TREE_H) ** 1.05 + 0.3) * 0.92
    c = k % len(BULBS)
    b = K.ball(f'bulb_{c}', 0.09, BULBS[c], at=(TX + math.cos(a) * r, TY + math.sin(a) * r, z - 0.25), group='dynamic', seg=8)
    bulbs.append((b, BULB_COLOURS[c]))
for k in range(4):
    a = k * math.pi / 2 + 0.4
    K.light('square_glow', 'POINT', (TX + math.cos(a) * 4.5, TY + math.sin(a) * 4.5, tz + 4.5), 900, '#FFD08A', size=1.5, group='tree')
marks['tree'] = (TX, TY, tz + TREE_H + 1.7)

STALL_WOOD = K.paper('stall_wood', '#8A5A36', pattern=K.stripes(['#8A5A36', '#7A4E2E', '#94623C'], 9.0, 'X'))
STALL_GLOW = K.glow('stall_glow', '#FFB861', 4.0)
GINGER = K.paper('ginger', '#B5703A')
ICING = K.paper('icing', '#FFF8EC')
STALL_COLOURS = ['#C42A3A', '#2D6A4B', '#D59A2C', '#2F5E9C']
AWNINGS = [K.paper(f'awning_{k}', c, pattern=K.stripes([c, '#F6EEE0'], 6.0, 'X')) for k, c in enumerate(STALL_COLOURS)]
STALL_PAINT = [K.paper(f'stall_paint_{k}', c) for k, c in enumerate(STALL_COLOURS)]
CREAM = K.paper('cream', '#F4ECDC')


def stall(x, y, rot, k):
    """A wooden market hut: open at the front, lit inside, an awning, gingerbread hearts hung along it"""
    gz = ground_z(x, y)
    pivot = bpy.data.objects.new('stall', None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.location = (x, y, gz)
    pivot.rotation_euler = (0, 0, rot)
    w, d, h = 2.6, 1.7, 2.2
    g = 'core'
    parts = []
    paint = STALL_PAINT[k % 4]
    dg = deco(g)
    parts.append(K.box('stall_back', (w, 0.1, h), STALL_WOOD, at=(0, d / 2, h / 2), bevel=0, group=g))
    for sx in (-1, 1):
        parts.append(K.box('stall_side', (0.1, d, h), STALL_WOOD, at=(sx * w / 2, 0, h / 2), bevel=0, group=g))
    # Its back and sides are what the square sees across the way: painted panels framed in cream,
    # a wreath on the back, a lantern at each corner
    pw, ph = w - 0.5, h - 0.9
    parts.append(K.box('stall_panel', (pw, 0.04, ph), paint, at=(0, d / 2 + 0.07, 0.45 + ph / 2), bevel=0, group=g))
    for u, v, sw, sh in ((0, 0.45, pw + 0.1, 0.06), (0, 0.45 + ph, pw + 0.1, 0.06), (-pw / 2, 0.45 + ph / 2, 0.06, ph), (pw / 2, 0.45 + ph / 2, 0.06, ph)):
        parts.append(K.box('stall_trim', (sw, 0.05, sh), CREAM, at=(u, d / 2 + 0.09, v), bevel=0, group=g))
    for sx in (-1, 1):
        parts.append(K.box('stall_side_panel', (0.04, d - 0.5, ph), paint, at=(sx * (w / 2 + 0.07), 0, 0.45 + ph / 2), bevel=0, group=g))
    parts.append(K.torus('stall_wreath', 0.26, 0.07, GREEN, at=(0, d / 2 + 0.14, 0.45 + ph * 0.55), rot=(math.pi / 2, 0, 0), group=dg, u=20, v=6))
    parts.append(K.ball('stall_wreath_bow', 0.09, RED if k % 4 != 0 else GOLD, at=(0, d / 2 + 0.2, 0.45 + ph * 0.55 - 0.24),
                        scale=(1.5, 0.6, 1.0), group=dg, seg=8))
    for sx in (-1, 1):
        for sy in (-1, 1):
            parts.append(K.ball('stall_lantern', 0.08, LAMP, at=(sx * (w / 2 + 0.05), sy * (d / 2 + 0.05), h - 0.15), group=dg, seg=8))
    parts.append(K.box('stall_glow', (w - 0.2, 0.04, h - 0.6), STALL_GLOW, at=(0, d / 2 - 0.08, h / 2 + 0.1), bevel=0, group=g))
    parts.append(K.box('counter', (w, 0.5, 0.95), STALL_WOOD, at=(0, -d / 2 + 0.25, 0.475), bevel=0.02, group=g))
    parts.append(K.box('counter_snow', (w + 0.05, 0.55, 0.08), SNOW, at=(0, -d / 2 + 0.25, 0.98), bevel=0.03, group=g))
    for j in range(5):
        parts.append(K.cyl('mug', 0.07, 0.12, [RED, WHITE, GREEN][j % 3], at=(-0.8 + j * 0.4, -d / 2 + 0.25, 1.02), seg=8, group=g))
    gable = [(-d / 2 - 0.4, 0), (d / 2 + 0.4, 0), (0, 0.9)]
    # A striped roof (its slopes too), the snow lying only along the top of it
    parts.append(K.cut('stall_roof', gable, w + 0.4, AWNINGS[k % 4], AWNINGS[k % 4], at=(-w / 2 - 0.2, 0, h), rot=(math.pi / 2, 0, math.pi / 2),
                       group=g))
    parts.append(K.box('stall_roof_snow', (w + 0.5, 0.85, 0.16), SNOW, at=(0, -0.26, h + 0.72), rot=(0.6, 0, 0), bevel=0.07, group=g))
    parts.append(K.box('stall_roof_snow', (w + 0.5, 0.85, 0.16), SNOW, at=(0, 0.26, h + 0.72), rot=(-0.6, 0, 0), bevel=0.07, group=g))
    # A valance of little pennants along both eaves
    for sy in (-1, 1):
        for j in range(9):
            px = -w / 2 - 0.1 + (j + 0.5) * (w + 0.2) / 9
            parts.append(K.cut('pennant', [(-0.12, 0), (0.12, 0), (0, -0.2)], 0.015, paint if j % 2 else CREAM, None,
                               at=(px, sy * (d / 2 + 0.42), h + 0.02), rot=(math.pi / 2, 0, 0), group=dg))
    for j in range(5):
        hx = -0.9 + j * 0.45
        heart = [(0, -0.14), (0.13, 0.0), (0.13, 0.06), (0.1, 0.11), (0.05, 0.12), (0, 0.08), (-0.05, 0.12), (-0.1, 0.11), (-0.13, 0.06),
                 (-0.13, 0.0)]
        parts.append(K.cut('heart', heart, 0.03, GINGER, ICING, at=(hx, -d / 2 - 0.05, h - 0.35), rot=(math.pi / 2, 0, 0), group=g))
    # Strings of lights along both eaves
    for sy in (-1, 1):
        pts = [(-w / 2 - 0.1 + (w + 0.2) * t / 12, sy * (d / 2 + 0.35), h + 0.05 - 0.12 * math.sin(math.pi * t / 12 * 2) ** 2)
               for t in range(13)]
        parts.append(K.tube('stall_string', pts, 0.01, INK, group=dg, res=3))
        for j, pt in enumerate(pts):
            c = (j + k) % len(BULBS)
            b = K.ball(f'bulb_{c}', 0.05, BULBS[c], at=pt, group='dynamic', seg=6)
            b.parent = pivot
            bulbs.append((b, BULB_COLOURS[c]))
    for o in parts:
        o.parent = pivot
    c, s = math.cos(rot), math.sin(rot)
    K.light('stall_light', 'POINT', (x + s * 1.4, y - c * 1.4, gz + 1.6), 70, '#FFB86A', size=0.4)


for k in range(10):
    a = -math.pi * 0.98 + k * (math.pi * 1.96 / 9)
    sx, sy = TX + math.cos(a) * 8.6, TY + math.sin(a) * 7.0
    if sy > -7:
        continue
    stall(sx, sy, math.atan2(TY - sy, TX - sx) + math.pi / 2, k)
# St. George's fountain on the square's south-east
FX_, FY_ = 11.0, -30.0
fz = ground_z(FX_, FY_)
K.cyl('basin', 2.2, 0.8, STONE, at=(FX_, FY_, fz), seg=8, bevel=0.03, group='core')
K.cyl('basin_snow', 2.1, 0.25, SNOW, at=(FX_, FY_, fz + 0.72), r2=1.7, seg=24, group='core')
K.cyl('column', 0.3, 3.2, STONE, at=(FX_, FY_, fz + 0.6), seg=12, group='core')
K.ball('column_top', 0.5, SNOW, at=(FX_, FY_, fz + 3.9), scale=(1, 1, 0.6), group='core')
K.torus('fountain_garland', 2.15, 0.12, GREEN, at=(FX_, FY_, fz + 0.85), group='core', u=32, v=6)
for k in range(10):
    a = 2 * math.pi * k / 10
    K.ball('garland_bow', 0.12, RED, at=(FX_ + math.cos(a) * 2.2, FY_ + math.sin(a) * 2.2, fz + 0.82), group='core', seg=8)
# Lamp posts round the square and along the main streets
lamp_spots = [(-15, -8), (15, -8), (-15, -32), (15, -33), (-6, -6), (6, -6)]
for name in ('herrngasse', 'schmiedgasse', 'hafengasse', 'klingengasse'):
    pts, w = STREETS[name]
    path = poly(pts, 14.0)
    for k, p in enumerate(path[1:-1]):
        a = path[k]
        tangent = (p - a).normalized()
        n = Vector((-tangent.y, tangent.x)) * (1 if k % 2 else -1)
        q = p + n * (w / 2 - 0.4)
        lamp_spots.append((q.x, q.y))
for lx, ly in lamp_spots:
    if math.hypot(lx, ly) > 140 or (townness(lx, ly) < 0.3 and rnd.random() < 0.5):
        continue
    g, det = near(lx, ly)
    lz = ground_z(lx, ly)
    K.cyl('lamp_post', 0.09, 3.6, IRON, at=(lx, ly, lz), seg=8, group=g)
    K.cyl('lamp_base', 0.2, 0.45, IRON, at=(lx, ly, lz), seg=8, group=g)
    K.box('lantern', (0.4, 0.4, 0.55), LAMP, at=(lx, ly, lz + 3.85), bevel=0, group=g)
    K.cyl('lantern_top', 0.36, 0.28, IRON, at=(lx, ly, lz + 4.12), r2=0.05, seg=4, rot=(0, 0, math.pi / 4), group=g)
    K.ball('lantern_snow', 0.22, SNOW, at=(lx, ly, lz + 4.35), scale=(1.2, 1.2, 0.5), group=g, seg=8)
    K.light('lamp_light', 'POINT', (lx, ly, lz + 3.7), 340 if det >= 1 else 220, '#FFC77A', size=0.3)
    lanterns.append((lx, ly, lz + 3.85))

# ---- The houses round the square ----

# East side of the square: tall gabled houses, shops downstairs
for k, yy in enumerate((-12.0, -18.6, -25.2, -31.8)):
    house(21.4, yy, 6.2, 8.0, rnd.choice((3, 4)), rot=-math.pi / 2, gable=k % 2 == 0, shop=True, sign=True, lights=True)
# South side: across from the red house
for k, xx in enumerate((-12.5, -5.8, 10.2, 16.8)):
    house(xx, -39.6, 6.4, 8.0, rnd.choice((3, 4)), rot=math.pi, gable=k % 2 == 1, shop=k % 2 == 0, sign=True, lights=True)

# ---- Down every street ----

for name, (pts, w) in STREETS.items():
    main = name in ('herrngasse', 'schmiedgasse', 'hafengasse', 'klingengasse')
    for side in (-1, 1):
        street_houses(name, side, floors=(3, 4) if main else (2, 3), gable_chance=0.55 if main else 0.35,
                      shop_chance=0.35 if main else 0.05, sign_chance=0.3 if main else 0.0)

# Strings of coloured lights across the old town's streets, house to house, every few houses
for name, (pts, w) in STREETS.items():
    path = poly(pts, 11.0)
    for k, (a, b) in enumerate(zip(path[:-1], path[1:])):
        mid = (a + b) / 2
        grp, det = near(mid.x, mid.y)
        if det == 0 or math.hypot(mid.x, mid.y) > 80:
            continue
        t = (b - a).normalized()
        n = Vector((-t.y, t.x))
        gz = ground_z(mid.x, mid.y)
        half = w / 2 + 0.7
        ends = [mid - n * half + t * (0.8 if k % 2 else -0.8), mid + n * half - t * (0.8 if k % 2 else -0.8)]
        pts_ = []
        for j in range(15):
            u = j / 14
            p_ = ends[0].lerp(ends[1], u)
            pts_.append((p_.x, p_.y, gz + 6.2 - 0.9 * math.sin(math.pi * u)))
        K.tube('street_string', pts_, 0.02, INK, group=deco(grp), res=3)
        for j, p_ in enumerate(pts_[1:-1]):
            c = (j + k) % len(BULBS)
            bulb = K.ball(f'bulb_{c}', 0.07, BULBS[c], at=p_, group='dynamic', seg=6)
            bulbs.append((bulb, BULB_COLOURS[c]))

# Behind the street fronts: back houses and sheds filling the blocks, lower
# Gardens kept green: the castle garden, the churchyard, yards between the blocks; and a strip
# inside the wall where the firs grow
GARDENS = [(-76.0, -12.0, 15.0), (-24.0, 62.0, 9.0), (40.0, 30.0, 10.0), (-42.0, 38.0, 10.0), (26.0, -52.0, 9.0), (-56.0, -62.0, 8.0),
           (62.0, -38.0, 8.0), (60.0, 52.0, 8.0), (-30.0, -70.0, 7.0), (14.0, 70.0, 8.0)]


def in_garden(x, y, pad=0.0):
    return any(math.hypot(x - gx, y - gy) < gr + pad for gx, gy, gr in GARDENS)


for k in range(1800):
    a = rnd.random() * math.pi * 2
    r = 10 + math.sqrt(rnd.random()) * 105
    x, y = math.cos(a) * r, math.sin(a) * r
    if rnd.random() > townness(x, y):
        continue
    w = 6.0 + rnd.random() * 4.0
    d = 7.0 + rnd.random() * 4.0
    if in_garden(x, y, max(w, d) / 2):
        continue
    if street_dist(x, y) < max(w, d) / 2 + 0.5:
        continue
    # Turned to the nearest street, more or less
    rot = round(math.atan2(y, x) / (math.pi / 2)) * (math.pi / 2) + rnd.uniform(-0.12, 0.12)
    if overlaps(x, y, w / 2, d / 2, rot, pad=0.3):
        continue
    g, det = near(x, y)
    house(x, y, w, d, rnd.choice((2, 3, 3)), rot=rot, gable=rnd.random() < 0.3, lights=False, spill=False, detail=min(det, 1) if g == 'core' else 0)

# ---- Landmarks ----

# St. Jakob: a long nave, tall Gothic windows, two spires at the east end
JX, JY = -24.0, 38.0
jz = ground_z(JX, JY)
K.box('nave', (12.0, 34.0, 16.0), STONE_WARM, at=(JX, JY, jz + 8.0), bevel=0.05, group='town')
# The gable runs the length of the nave under its roof (turned up on end it reaches back from `at`)
K.cut('nave_gable', [(-6.4, 0), (6.4, 0), (0, 9.0)], 34.0, STONE_WARM, EDGE, at=(JX, JY + 17.0, jz + 16.0), rot=(math.pi / 2, 0, 0),
      group='town')
for sgn in (-1, 1):
    # Ridge to eave over the gable's whole slope, a little over at the eave
    roof_slab((11.5, 34.6, 0.25), ROOFS[3], TRIM[0], at=(JX + sgn * 3.36, JY, jz + 20.49), rot=(0, sgn * 0.95, 0), bevel=0.03, group='town')
    # Snow high on the slopes, lumpy along its lower edge, the copper-green tiles below
    K.box('nave_roof_snow', (4.8, 34.4, 0.34), SNOW, at=(JX + sgn * 1.42, JY, jz + 23.39), rot=(0, sgn * 0.95, 0), bevel=0.12, group='town')
    for j in range(14):
        K.ball('nave_snow_lump', 0.6 + 0.15 * ((j * 5) % 3), SNOW, at=(JX + sgn * 2.81, JY - 16.0 + j * 2.45, jz + 21.45),
               scale=(0.9, 1.5, 0.42), group='town', seg=10)
for k in range(6):
    yy = JY - 13.0 + k * 5.2
    arch = [(-0.8, 0), (0.8, 0)] + [(0.8 * math.cos(math.pi * j / 10), 5.0 + 0.8 * math.sin(math.pi * j / 10)) for j in range(11)]
    for sgn in (-1, 1):
        K.cut('jakob_window', arch, 0.08, STAINED[(k + (sgn > 0)) % 3], EDGE, at=(JX + sgn * 6.04, yy, jz + 4.0),
              rot=(math.pi / 2, 0, math.pi / 2), group='town')
K.light('jakob_glow', 'POINT', (JX, JY, jz + 8.0), 2500, '#FFC27A', size=3.0)
for sx in (-3.6, 3.6):
    SX_, SY_ = JX + sx, JY + 19.0
    K.box('spire_tower', (4.4, 4.4, 26.0), STONE_WARM, at=(SX_, SY_, jz + 13.0), bevel=0.05, group='town')
    K.cyl('spire', 2.9, 16.0, ROOFS[5], at=(SX_, SY_, jz + 26.0), r2=0.05, seg=8, group='town')
    K.cyl('spire_snow', 2.95, 2.0, SNOW, at=(SX_, SY_, jz + 26.0), r2=2.55, seg=8, group='town')
    K.ball('spire_knob', 0.35, GOLD, at=(SX_, SY_, jz + 42.2), group='town', seg=10)
    for zz in (12.0, 19.0):
        for face in range(4):
            a = face * math.pi / 2
            window(SX_ + math.cos(a) * 2.22, SY_ + math.sin(a) * 2.22, jz + zz, a, w=0.7, h=1.8, lit=zz > 15, group='town', detail=0)
marks['jakob'] = (JX, JY + 19.0, jz + 42.2)
footprints.append((JX, JY, 6.5, 17.5, 0.0))
footprints.append((JX, JY + 19.0, 7.0, 2.5, 0.0))

# The Plönlein: the little yellow house at the fork, a tower up each way
PX, PY = -3.0, -79.0
house(PX, PY, 5.2, 8.5, 4, rot=0.0, gable=True, wall=K.paper('ploenlein', '#F2D27A'), roof=ROOFS[0], timbered=True, lights=True,
      group='town', detail=2, spill=True)
marks['ploenlein'] = (PX, PY, ground_z(PX, PY) + 17.0)


def gate_tower(x, y, rot, h, w=5.0, roof=None, name='gate', group='town', arch=True):
    """A square tower over a gateway arch, a steep roof, a clock or a window up top"""
    gz = ground_z(x, y)
    pivot = bpy.data.objects.new(name, None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.location = (x, y, gz)
    pivot.rotation_euler = (0, 0, rot)
    parts = [K.box(name + '_body', (w, w, h), STONE, at=(0, 0, h / 2), bevel=0.04, group=group)]
    if arch:
        a = [(-1.5, 0), (1.5, 0)] + [(1.5 * math.cos(math.pi * j / 12), 3.4 + 1.5 * math.sin(math.pi * j / 12)) for j in range(13)]
        for s in (-1, 1):
            parts.append(K.cut(name + '_arch', a, 0.2, SOOT, EDGE, at=(0, s * (w / 2 + 0.02) - (0.2 if s > 0 else 0), 0), rot=(math.pi / 2, 0, 0),
                               group=group))
    parts.append(K.cyl(name + '_roof', w * 0.82, h * 0.55, roof or ROOFS[0], at=(0, 0, h), r2=0.0, seg=4, rot=(0, 0, math.pi / 4), group=group))
    parts.append(K.cyl(name + '_roof_snow', w * 0.83, h * 0.12, SNOW, at=(0, 0, h), r2=w * 0.66, seg=4, rot=(0, 0, math.pi / 4), group=group))
    for s in (-1, 1):
        before = set(bpy.context.scene.objects)
        window(0, s * (w / 2 + 0.02), h * 0.72, s * math.pi / 2, w=0.6, h=0.9, lit=True, group=group, detail=1)
        parts.extend(o for o in bpy.context.scene.objects if o not in before and o.type != 'LIGHT')
    parts.append(K.torus(name + '_wreath', 0.7, 0.15, GREEN, at=(0, -w / 2 - 0.15, 5.6), rot=(math.pi / 2, 0, 0), group=group, u=24, v=6))
    for o in parts:
        o.parent = pivot
    footprints.append((x, y, w / 2, w / 2, rot))
    return (x, y, gz + h * 1.55)


marks['sieber'] = gate_tower(-14.0, -93.0, -0.6, 17.0, name='sieber')
marks['kobolzell'] = gate_tower(5.5, -96.0, 0.35, 14.0, name='kobolzell')
marks['markus'] = gate_tower(43.0, -7.0, math.pi / 2 + 0.05, 19.0, w=4.6, name='markus')

def fir(x, y, hh, group, decorated=False, layers=5):
    """A fir in snow: tiers of cut card, snow on every one; decorated ones lit and hung with baubles"""
    pz = ground_z(x, y)
    for j in range(layers):
        t = j / layers
        rr = hh * 0.34 * (1 - t * 0.8)
        z = pz + 0.35 + t * hh * 0.8
        pts = 9 if group != 'outer' else 6
        K.cut('fir', K.star_outline(pts, rr, rr * 0.62, rot=j * 0.7 + x), hh * 0.06, FIR[(j + int(x)) % 3], EDGE_GREEN, at=(x, y, z),
              group=group)
        K.cut('fir_snow', K.star_outline(pts, rr * 0.72, rr * 0.45, rot=j * 0.7 + x), hh * 0.035, SNOW, EDGE, at=(x, y, z + hh * 0.06),
              group=group)
        if decorated:
            for k in range(6):
                a = k * math.pi / 3 + j
                K.ball('fir_light', 0.05 + hh * 0.004, FAIRY if k % 2 else (RED if k % 4 == 0 else GOLD), at=(x + math.cos(a) * rr * 0.85,
                       y + math.sin(a) * rr * 0.85, z - 0.04), group=group, seg=6)
    K.cyl('fir_trunk', hh * 0.05, 0.5, BARK, at=(x, y, pz), seg=6, group=group)
    if decorated:
        K.cut('fir_star', K.star_outline(5, hh * 0.07, hh * 0.03), 0.04, GOLD, EDGE, at=(x, y, pz + 0.4 + hh * 0.84), rot=(math.pi / 2, 0, 0),
              group=group)


def bare_tree(x, y, hh, group, lights=True):
    """A linden along the street in winter: bare branches with snow along their tops, fairy lights wound round"""
    pz = ground_z(x, y)
    seed = random.Random(int(x * 100 + y * 7))
    K.tube('trunk', [(x, y, pz), (x + 0.05, y, pz + hh * 0.3), (x, y + 0.05, pz + hh * 0.5)], hh * 0.035, BARK, group=group,
           taper=[1.0, 0.8, 0.6], res=3)
    for b in range(5):
        a = b * 2 * math.pi / 5 + seed.uniform(-0.3, 0.3)
        base = Vector((x, y, pz + hh * (0.38 + 0.05 * b)))
        mid = base + Vector((math.cos(a) * hh * 0.22, math.sin(a) * hh * 0.22, hh * 0.25))
        tip = mid + Vector((math.cos(a + 0.3) * hh * 0.16, math.sin(a + 0.3) * hh * 0.16, hh * 0.22))
        K.tube('branch', [tuple(base), tuple(mid), tuple(tip)], hh * 0.018, BARK, group=group, taper=[1.0, 0.7, 0.3], res=3)
        K.tube('branch_snow', [tuple(mid + Vector((0, 0, hh * 0.016))), tuple(tip + Vector((0, 0, hh * 0.008)))], hh * 0.012, SNOW,
               group=group, taper=[1.0, 0.4], res=2)
        for t_ in range(2):
            ta = a + seed.uniform(-0.9, 0.9)
            twig_from = mid.lerp(tip, 0.3 + 0.4 * t_)
            twig = twig_from + Vector((math.cos(ta) * hh * 0.1, math.sin(ta) * hh * 0.1, hh * 0.1))
            K.tube('twig', [tuple(twig_from), tuple(twig)], hh * 0.007, BARK, group=group, taper=[1.0, 0.3], res=2)
        if lights:
            for k in range(5):
                q = base.lerp(mid, k / 4) if k < 3 else mid.lerp(tip, (k - 2) / 3)
                K.ball('tree_light', 0.06, FAIRY, at=tuple(q + Vector((0, 0, -0.05))), group=group, seg=6)
    footprints.append((x, y, 0.8, 0.8, 0.0))


def bench(x, y, rot, group):
    pivot = bpy.data.objects.new('bench', None)
    bpy.context.scene.collection.objects.link(pivot)
    pivot.location = (x, y, ground_z(x, y))
    pivot.rotation_euler = (0, 0, rot)
    parts = [K.box('bench_seat', (1.6, 0.45, 0.06), WOOD, at=(0, 0, 0.45), bevel=0, group=group),
             K.box('bench_back', (1.6, 0.05, 0.45), WOOD, at=(0, 0.22, 0.75), bevel=0, group=group),
             K.box('bench_snow', (1.55, 0.42, 0.1), SNOW, at=(0, 0, 0.52), bevel=0.04, group=group)]
    for sx in (-0.7, 0.7):
        parts.append(K.box('bench_leg', (0.06, 0.45, 0.45), IRON, at=(sx, 0, 0.22), bevel=0, group=group))
    for o in parts:
        o.parent = pivot


def planter(x, y, group):
    """A tub with a little decorated fir in it, by a door or along the pavement"""
    pz = ground_z(x, y)
    K.cyl('tub', 0.35, 0.5, TIMBER_RED, at=(x, y, pz), seg=10, group=group)
    K.cyl('tub_band', 0.36, 0.06, IRON, at=(x, y, pz + 0.38), seg=10, group=group)
    K.cyl('tub_snow', 0.33, 0.06, SNOW, at=(x, y, pz + 0.5), seg=10, group=group)
    fir(x, y + 0.0, 1.4, group, decorated=True, layers=4)


def pavements():
    """Kerbs down the streets, the pavement inside them, snow shovelled into heaps against the kerb"""
    for name, (pts, w) in STREETS.items():
        path = poly(pts, 2.5)
        for a, b in zip(path[:-1], path[1:]):
            mid = (a + b) / 2
            if townness(mid.x, mid.y) < 0.25:
                continue
            g, det = near(mid.x, mid.y)
            if det == 0:
                continue
            L = (b - a).length
            t = (b - a).normalized()
            n = Vector((-t.y, t.x))
            rot = math.atan2(t.y, t.x)
            for side in (-1, 1):
                kerb = mid + n * side * w * 0.33
                K.box('kerb', (L + 0.05, 0.22, 0.14), STONE, at=(kerb.x, kerb.y, ground_z(kerb.x, kerb.y) + 0.07), rot=(0, 0, rot), bevel=0,
                      group=g)
                walk = mid + n * side * (w * 0.33 + (w * 0.17) / 2 + 0.11)
                K.box('pavement', (L + 0.05, w * 0.17, 0.05), COBBLE, at=(walk.x, walk.y, ground_z(walk.x, walk.y) + 0.03), rot=(0, 0, rot),
                      bevel=0, group=g)
                if rnd.random() < 0.35:
                    heap = mid + n * side * (w * 0.33 - 0.25)
                    K.ball('snow_heap', 0.5 + rnd.random() * 0.4, SNOW, at=(heap.x, heap.y, ground_z(heap.x, heap.y)), scale=(1.8, 0.9, 0.55),
                           group=g, seg=8)


def furnish():
    """Along the pavements: benches, bollards, tubs of firs, barrels, a sled left out, and trees"""
    for name in ('herrngasse', 'schmiedgasse', 'hafengasse', 'klingengasse', 'lane_e'):
        pts, w = STREETS[name]
        path = poly(pts, 7.0)
        for k, p in enumerate(path[1:-1]):
            a = path[k]
            t = (p - a).normalized()
            n = Vector((-t.y, t.x)) * (1 if k % 2 else -1)
            q = p + n * (w * 0.42)
            if townness(q.x, q.y) < 0.3 or overlaps(q.x, q.y, 0.4, 0.4, 0.0, pad=0.1):
                continue
            g, det = near(q.x, q.y)
            pick = rnd.random()
            if det >= 1 and pick < 0.35 and w >= 6:
                bare_tree(q.x, q.y, 6.0 + rnd.random() * 2.0, g, lights=det >= 1)
            elif det >= 1 and pick < 0.55:
                planter(q.x, q.y, g)
            elif det >= 1 and pick < 0.7:
                bench(q.x, q.y, math.atan2(n.y, n.x) + math.pi / 2, g)
            elif det >= 2 and pick < 0.8:
                K.cyl('barrel', 0.35, 0.8, WOOD, at=(q.x, q.y, ground_z(q.x, q.y)), seg=10, group=g)
                K.cyl('barrel_snow', 0.33, 0.08, SNOW, at=(q.x, q.y, ground_z(q.x, q.y) + 0.8), seg=10, group=g)
            elif det >= 1:
                K.cyl('bollard', 0.14, 0.75, STONE, at=(q.x, q.y, ground_z(q.x, q.y)), seg=8, group=g)
                K.ball('bollard_snow', 0.15, SNOW, at=(q.x, q.y, ground_z(q.x, q.y) + 0.78), scale=(1, 1, 0.5), group=g, seg=8)


pavements()
furnish()
# Tubs of firs by the doors round the square
for px_, py_ in ((-2.9, -4.0), (0.2, -4.0), (-9.0, -4.6), (9.5, -4.4)):
    planter(px_, py_, 'core')
# Lindens round the square, lit
for k, (lx, ly) in enumerate(((-15.5, -10), (-15.5, -28), (15.5, -10), (15.5, -28), (-9, -34), (9, -34.2))):
    bare_tree(lx, ly, 8.5, 'core', lights=True)
# A Christmas pyramid by the fountain: tiers of figures under a turning star of blades, candles round each tier
PYX, PYY = -11.0, -30.0
pyz = ground_z(PYX, PYY)
for k, (r, zz) in enumerate(((2.2, 0.0), (1.7, 1.6), (1.2, 3.0), (0.8, 4.2))):
    K.cyl('pyramid_tier', r, 0.14, WOOD, at=(PYX, PYY, pyz + zz + 0.6), seg=12, group='core')
    K.cyl('pyramid_tier_snow', r * 0.97, 0.06, SNOW, at=(PYX, PYY, pyz + zz + 0.74), seg=12, group='core')
    for j in range(8):
        a = 2 * math.pi * j / 8
        K.cyl('pyramid_candle', 0.05, 0.35, WHITE, at=(PYX + math.cos(a) * r * 0.92, PYY + math.sin(a) * r * 0.92, pyz + zz + 0.74), seg=6,
              group='core')
        K.ball('pyramid_flame', 0.05, LAMP, at=(PYX + math.cos(a) * r * 0.92, PYY + math.sin(a) * r * 0.92, pyz + zz + 1.15), group='core', seg=6)
        if j % 2 == 0 and k < 3:
            K.cyl('pyramid_figure', 0.14, 0.7, [RED, GREEN, GOLD][k], at=(PYX + math.cos(a + 0.4) * r * 0.55, PYY + math.sin(a + 0.4) * r * 0.55,
                  pyz + zz + 0.74), r2=0.05, seg=8, group='core')
for j in range(4):
    a = j * math.pi / 2
    K.cyl('pyramid_post', 0.08, 5.0, WOOD, at=(PYX + math.cos(a) * 1.9, PYY + math.sin(a) * 1.9, pyz + 0.6), seg=6, group='core')
K.cyl('pyramid_spindle', 0.1, 6.4, WOOD, at=(PYX, PYY, pyz + 0.6), seg=8, group='core')
for j in range(8):
    a = 2 * math.pi * j / 8
    K.box('pyramid_blade', (1.5, 0.35, 0.03), WOOD, at=(PYX + math.cos(a) * 0.8, PYY + math.sin(a) * 0.8, pyz + 7.0), rot=(0.5, 0, a),
          bevel=0, group='core')
K.cut('pyramid_star', K.star_outline(5, 0.45, 0.2), 0.08, GOLD, EDGE, at=(PYX, PYY, pyz + 7.6), rot=(math.pi / 2, 0, 0), group='core')
K.light('pyramid_glow', 'POINT', (PYX, PYY, pyz + 3.0), 260, '#FFC27A', size=1.0)
footprints.append((PYX, PYY, 2.3, 2.3, 0.0))
marks['pyramid'] = (PYX, PYY, pyz + 7.6)

# The gardens, thick with firs, a few bare trees among them; firs along the inside of the wall
for gx, gy, gr in GARDENS:
    g, _ = near(gx, gy)
    for k in range(int(gr * gr * 0.5)):
        a = rnd.random() * math.pi * 2
        r = math.sqrt(rnd.random()) * gr
        px, py = gx + math.cos(a) * r, gy + math.sin(a) * r
        if street_dist(px, py) < 1.5 or overlaps(px, py, 1.1, 1.1, 0.0, pad=0.1):
            continue
        if rnd.random() < 0.2:
            bare_tree(px, py, 5.5 + rnd.random() * 3.0, g, lights=rnd.random() < 0.5)
        else:
            fir(px, py, 3.5 + rnd.random() * 5.5, g, decorated=rnd.random() < 0.1, layers=4)
            footprints.append((px, py, 1.1, 1.1, 0.0))
# ---- Out past the town: farms along the roads, fences, woods, single trees in the fields ----

FENCE = K.paper('fence', '#6B4A33')
for name in ('herrngasse', 'hafengasse', 'klingengasse', 'sieber', 'kobolzell'):
    pts, w = STREETS[name]
    path = poly(pts, 1.0)
    total = len(path)
    # A farm or two along each road out: the farmhouse, its barn, a fenced yard
    for k in range(3):
        i = int(total * (0.72 + 0.09 * k))
        if i >= total - 2:
            continue
        p, q = path[i], path[i + 1]
        t = (q - p).normalized()
        n = Vector((-t.y, t.x)) * (1 if k % 2 else -1)
        c = p + n * (w / 2 + 9)
        if townness(c.x, c.y) > 0.35 or overlaps(c.x, c.y, 6, 6, 0.0):
            continue
        rot = math.atan2(n.y, n.x) - math.pi / 2
        house(c.x, c.y, 8.0, 9.0, 2, rot=rot, gable=False, lights=True, group='outer', detail=1, timbered=True)
        b_ = c + t * 13 + n * 2
        house(b_.x, b_.y, 10.0, 8.0, 1, rot=rot + math.pi / 2, gable=True, lights=False, group='outer', detail=0, timbered=False,
              wall=K.paper('barn', '#8E4A35'), chimney=False)
    # Fences along the road through the fields
    for side in (-1, 1):
        for i in range(0, total - 3, 3):
            p, q = path[i], path[i + 3]
            mid = (p + q) / 2
            if townness(mid.x, mid.y) > 0.2 or math.hypot(mid.x, mid.y) > 146:
                continue
            t = (q - p).normalized()
            n = Vector((-t.y, t.x)) * side
            f = mid + n * (w / 2 + 1.2)
            if overlaps(f.x, f.y, 1.6, 0.2, math.atan2(t.y, t.x)):
                continue
            gz = ground_z(f.x, f.y)
            K.box('fence_rail', ((q - p).length + 0.1, 0.06, 0.1), FENCE, at=(f.x, f.y, gz + 0.8), rot=(0, 0, math.atan2(t.y, t.x)), bevel=0,
                  group='outer')
            K.box('fence_rail_snow', ((q - p).length + 0.1, 0.1, 0.06), SNOW, at=(f.x, f.y, gz + 0.88), rot=(0, 0, math.atan2(t.y, t.x)),
                  bevel=0, group='outer')
            K.box('fence_post', (0.12, 0.12, 1.0), FENCE, at=(p.x + n.x * (w / 2 + 1.2), p.y + n.y * (w / 2 + 1.2), gz + 0.45), bevel=0,
                  group='outer')
# Woods: clumps of firs out in the fields, thicker toward the edge
for k in range(22):
    a = rnd.random() * math.pi * 2
    r = edge_r(a) + 18 + rnd.random() * 40
    cx, cy = math.cos(a) * r, math.sin(a) * r
    if street_dist(cx, cy) < 8 or r > 140:
        continue
    for j in range(rnd.randint(10, 26)):
        aa = rnd.random() * math.pi * 2
        rr = math.sqrt(rnd.random()) * (7 + rnd.random() * 6)
        px, py = cx + math.cos(aa) * rr, cy + math.sin(aa) * rr
        if street_dist(px, py) < 2.5 or overlaps(px, py, 1.0, 1.0, 0.0, pad=0.0) or math.hypot(px, py) > 145:
            continue
        fir(px, py, 4.0 + rnd.random() * 6.0, 'outer', layers=3)
        footprints.append((px, py, 1.0, 1.0, 0.0))
# Lone trees along the town's ragged edge and out in the fields
for k in range(260):
    a = rnd.random() * math.pi * 2
    r = edge_r(a) - 10 + rnd.random() * 70
    px, py = math.cos(a) * r, math.sin(a) * r
    if r > 142 or street_dist(px, py) < 2.5 or overlaps(px, py, 1.2, 1.2, 0.0, pad=0.1):
        continue
    if rnd.random() < 0.25:
        bare_tree(px, py, 5.0 + rnd.random() * 3.0, 'outer', lights=False)
    else:
        fir(px, py, 3.5 + rnd.random() * 5.0, 'outer', layers=3)
        footprints.append((px, py, 1.0, 1.0, 0.0))
# And wherever else there's a yard
for k in range(700):
    a = rnd.random() * math.pi * 2
    r = 12 + math.sqrt(rnd.random()) * (WALL_R - 16)
    px, py = math.cos(a) * r, math.sin(a) * r
    if street_dist(px, py) < 2.0 or overlaps(px, py, 1.4, 1.4, 0.0, pad=0.2):
        continue
    g, _ = near(px, py)
    fir(px, py, 3.0 + rnd.random() * 5.0, g, decorated=rnd.random() < 0.12, layers=4 if g != 'core' else 5)
    footprints.append((px, py, 1.2, 1.2, 0.0))

# Pines inside too, in the gardens and the castle garden
for k in range(0):
    a = rnd.random() * math.pi * 2
    r = 20 + rnd.random() * (WALL_R - 26)
    px, py = math.cos(a) * r, math.sin(a) * r
    if street_dist(px, py) < 2.5 or overlaps(px, py, 1.5, 1.5, 0.0, pad=0.3):
        continue
    g, _ = near(px, py)
    pz = ground_z(px, py)
    hh = 3.0 + rnd.random() * 3.5
    for j in range(3):
        t = j / 3
        rr = hh * 0.32 * (1 - t * 0.75)
        K.cut('pine', K.star_outline(8, rr, rr * 0.6, rot=j + k), hh * 0.06, GREEN if (j + k) % 2 else GREEN_LIGHT, EDGE_GREEN,
              at=(px, py, pz + 0.4 + t * hh * 0.75), group=g)
        K.cut('pine_snow', K.star_outline(8, rr * 0.7, rr * 0.45, rot=j + k), hh * 0.04, SNOW, EDGE,
              at=(px, py, pz + 0.4 + t * hh * 0.75 + hh * 0.06), group=g)
    footprints.append((px, py, 1.0, 1.0, 0.0))

# Lights strung across the main streets, house to house
for name in ('herrngasse', 'schmiedgasse', 'hafengasse', 'klingengasse'):
    pts, w = STREETS[name]
    path = poly(pts, 9.0)
    for k, p in enumerate(path[1:-1]):
        a = path[k]
        tangent = (p - a).normalized()
        n = Vector((-tangent.y, tangent.x))
        A, B = p - n * (w / 2 + 0.3), p + n * (w / 2 + 0.3)
        g, det = near(p.x, p.y)
        z = ground_z(p.x, p.y) + 6.0
        string = []
        for j in range(15):
            t = j / 14
            q = A.lerp(B, t)
            string.append((q.x, q.y, z - 1.0 * math.sin(math.pi * t)))
        K.tube('street_string', string, 0.015, INK, group=g, res=3)
        for j, q in enumerate(string[1:-1]):
            c = (j * 3 + k) % len(BULBS)
            b = K.ball(f'bulb_{c}', 0.08, BULBS[c], at=(q[0], q[1], q[2] - 0.08), group='dynamic', seg=6)
            bulbs.append((b, BULB_COLOURS[c]))
# Lights across the square, from the tree out to the houses
for k in range(8):
    a = k * math.pi / 4 + 0.2
    A = Vector((TX, TY))
    B = Vector((TX + math.cos(a) * 15.0, TY + math.sin(a) * 13.0))
    z0, z1 = tz + TREE_H * 0.85, ground_z(B.x, B.y) + 6.0
    string = []
    for j in range(23):
        t = j / 22
        q = A.lerp(B, t)
        string.append((q.x, q.y, z0 + (z1 - z0) * t - 1.4 * math.sin(math.pi * t)))
    K.tube('square_string', string, 0.015, INK, group='core', res=3)
    for j, q in enumerate(string[2:-1]):
        c = (j + k) % len(BULBS)
        b = K.ball(f'bulb_{c}', 0.085, BULBS[c], at=(q[0], q[1], q[2] - 0.08), group='dynamic', seg=6)
        bulbs.append((b, BULB_COLOURS[c]))

# A snowman by the fountain
SX, SY = 7.0, -27.0
sz = ground_z(SX, SY)
for k, (r, zz) in enumerate(((0.75, 0.6), (0.55, 1.6), (0.4, 2.35))):
    K.ball('snowman', r, SNOW, at=(SX, SY, sz + zz), scale=(1, 1, 0.95), group='core', seg=16)
K.cyl('hat', 0.32, 0.08, INK, at=(SX, SY, sz + 2.68), group='core', seg=12)
K.cyl('hat_top', 0.22, 0.42, INK, at=(SX, SY, sz + 2.72), group='core', seg=12)
K.cyl('hat_band', 0.225, 0.08, RED, at=(SX, SY, sz + 2.78), group='core', seg=12)
K.cyl('carrot', 0.06, 0.4, CARROT, at=(SX, SY - 0.38, sz + 2.35), r2=0.0, rot=(math.pi / 2, 0, 0), seg=8, group='core')
for ex in (-0.13, 0.13):
    K.ball('coal', 0.045, INK, at=(SX + ex, SY - 0.36, sz + 2.48), group='core', seg=8)
K.torus('scarf', 0.45, 0.1, RED, at=(SX, SY, sz + 2.02), group='core', u=20, v=6)
for s in (-1, 1):
    K.tube('arm', [(SX + s * 0.45, SY, sz + 1.7), (SX + s * 0.9, SY - 0.1, sz + 2.0), (SX + s * 1.15, SY - 0.1, sz + 2.3)], 0.035, TIMBER,
           group='core', res=3)

# ---- Light ----

world = bpy.data.worlds.new('night')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = K.lin('#24305E')
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.55
world['strength'] = 0.55
sun = bpy.data.lights.new('moonlight', 'SUN')
sun.energy = 0.9
sun.color = K.lin('#A9BEFF')[:3]
sun.angle = math.radians(8)
sun_o = bpy.data.objects.new('moonlight', sun)
sun_o.rotation_euler = (math.radians(55), 0, math.radians(200))
sun_o['light_group'] = 'base'
scene.collection.objects.link(sun_o)

# ---- Cameras ----

cam = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
scene.collection.objects.link(cam)
target = bpy.data.objects.new('target', None)
scene.collection.objects.link(target)
if VIEW == 'roof':
    cam.location = (CHIMNEY[0] - 3.0, CHIMNEY[1] - 7.0, CHIMNEY[2] + 3.0)
    target.location = (CHIMNEY[0] - 1.0, CHIMNEY[1], CHIMNEY[2] - 1.0)
elif VIEW == 'square':
    cam.location = (-4.0, -33.0, 7.0)
    target.location = (0.5, -3.0, 6.0)
elif VIEW == 'top':
    cam.location = (0.0, -12.0, 260.0)
    target.location = (0.0, -10.0, 0.0)
elif VIEW == 'rathaus':
    cam.location = (-6.0, 4.0, 30.0)
    target.location = (-26.0, -19.0, 17.0)
elif VIEW == 'church':
    # Over the square toward the town hall and St. Jakob, the way the camera rises after takeoff
    cam.location = (14.0, -2.0, 40.0)
    target.location = (-22.0, 20.0, 16.0)
elif VIEW == 'window':
    # Out of the red house's window, across the market to the tree
    cam.location = (-1.6, -4.5, 3.2)
    target.location = (0.0, -19.0, 2.4)
elif VIEW == 'fly':
    # Where the sleigh comes round the square: up over the market, the red house ahead
    cam.location = (16.0, -48.0, 24.0)
    target.location = (0.0, -12.0, 5.0)
elif VIEW == 'street':
    cam.location = (2.0, -70.0, 6.0)
    target.location = (0.0, -30.0, 8.0)
else:
    cam.location = (40.0, -150.0, 110.0)
    target.location = (0.0, -10.0, 0.0)
c = cam.constraints.new('TRACK_TO')
c.target = target
cam.data.sensor_fit = 'VERTICAL'
cam.data.angle = math.radians(50)
cam.data.clip_end = 900
scene.camera = cam
scene.render.resolution_x = 1170
scene.render.resolution_y = 820

if MODE == 'preview':
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.filepath = OUT
    for o in [o for o in scene.objects if o.get('group') == 'cutter']:
        o.hide_render = True
    bpy.ops.render.render(write_still=True)
    print('rendered', OUT)

if MODE == 'bake':
    os.makedirs(OUT, exist_ok=True)
    def is_roof(name):
        return name.startswith('roof_') or name == 'hero_roof'

    hero = K.flatten_join('hero', 'hero')
    core = K.flatten_join('core', 'core')
    town = K.flatten_join('town', 'town')
    outer = K.flatten_join('outer', 'outer')
    deco_part = K.flatten_join('deco', 'deco')
    for o in [o for o in scene.objects if o.get('group') == 'cutter']:
        bpy.data.objects.remove(o)
    data = {
        # Thin margins between the islands: with this many little pieces, wide ones would take up most
        # of the maps, and the thin faces (a roof's edge, a barge board) would get less than a texel
        # Packed tight (xmas_kit.lightmap_uv), these sizes give every surface several times the texels
        # the old ones did, in under half the memory
        'hero': K.bake_export(hero, 'hero', OUT, alb=2048, lit=2048, margin=0.0015, roofs=is_roof),
        'core': K.bake_export(core, 'core', OUT, alb=4096, lit=2048, emit=2048, margin=0.0008, roofs=is_roof),
        'deco': K.bake_export(deco_part, 'deco', OUT, alb=2048, lit=1024, margin=0.0015),
        'town': K.bake_export(town, 'town', OUT, alb=4096, lit=2048, emit=2048, margin=0.0008, roofs=is_roof),
        'outer': K.bake_export(outer, 'outer', OUT, alb=2048, lit=1024, emit=1024, samples=256, margin=0.001, roofs=is_roof),
    }
    data['bulbs'] = [{'at': K.three(b.matrix_world.translation if hasattr(b, 'matrix_world') else b), 'c': c} for b, c in bulbs]
    bpy.context.view_layer.update()
    data['stars'] = [{'at': K.three(o.matrix_world.translation), 'n': K.three((o.matrix_world.to_3x3() @ Vector((0, 0, -1))).normalized()),
                      'r': round(r, 3), 'c': c} for o, c, r in win_stars]
    data['star'] = K.three(STAR)
    data['chimney'] = K.three(CHIMNEY)
    data['chimneys'] = [K.three(c) for c in chimneys]
    data['lanterns'] = [K.three(l) for l in lanterns]
    # The sleigh lands on the ridge, west of the chimney, facing along it (-x)
    data['ridge'] = K.three((-1.6, 0.0, RIDGE))
    data['marks'] = {k: K.three(v) for k, v in marks.items()}
    data['square'] = K.three((SQUARE[0], SQUARE[1], ground_z(*SQUARE)))
    data['window'] = K.three(HERO.WINDOW_AT)
    data['streets'] = {k: [K.three((x, y, ground_z(x, y))) for x, y in pts] for k, (pts, w) in STREETS.items()}
    K.write_json(os.path.join(OUT, 'town.json'), data)
