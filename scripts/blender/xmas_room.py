"""
The living room on Christmas Eve, where the present comes down the chimney: a papercraft room
lit by the fire, the tree and a lamp, a child asleep in the armchair, the cat on the rug, milk and
cookies left out on the hearth, and through the window, the town square.

The room stands inside the red house in the town (xmas_hero.py has where): its flue goes on up into
the house's chimney, and its window is the house's, opening onto the square. There's no picture of
the night outside any more; the town is out there.

  Blender -b -P scripts/blender/xmas_room.py -- preview <out.png>   a Cycles render from the hero camera
  Blender -b -P scripts/blender/xmas_room.py -- bake <out dir>      bake and export for the app

Blender axes: x right, y into the room (the back wall at y = 2), z up.
"""

import math
import os
import random
import sys

import bmesh
import bpy
from mathutils import Vector

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import xmas_hero as HERO  # noqa: E402
import xmas_kit as K  # noqa: E402

args = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else ['preview', '/tmp/room.png']
MODE, OUT = args[0], args[1]
rnd = random.Random(7)

K.reset()
scene = bpy.context.scene

# ---- Materials ----

WALL = K.paper('wall', '#2F5B4B', pattern=K.wallpaper('#2C5747', '#3A6E5A', '#D9C28C', 3.2))
WAINSCOT = K.paper('wainscot', '#EFE2C8')
WOOD = K.paper('wood', '#8B5A3A', rough=0.7, pattern=K.planks('#8B5A3A', '#7A4C30', 0.12, 0.9))
WOOD_DARK = K.paper('wood_dark', '#5E3B26', rough=0.6)
EDGE = K.paper('edge', '#F4EBDD', fiber=0.15)
EDGE_GREEN = K.paper('edge_green', '#CFE3C4', fiber=0.15)
FLOOR = K.paper('floor', '#9A6A45', rough=0.6, pattern=K.planks('#A4724B', '#8E603F', 0.16, 1.4))
CEILING = K.paper('ceiling', '#E9DEC8')
BRICK = K.paper('brick', '#A8452F', pattern=K.bricks('#A8452F', '#BC5A3E', '#E6D3BB', 7.0))
SOOT = K.paper('soot', '#22170F', rough=1.0)
STONE = K.paper('stone', '#9C928A', rough=0.8)
CREAM = K.paper('cream', '#F2E7D2')
WHITE = K.paper('white', '#FAF6EE')
RED = K.paper('red', '#C42A3A')
RED_DEEP = K.paper('red_deep', '#8F1C2B', sheen=0.6)
GREEN = K.paper('green', '#2E6E4D')
GREEN_LIGHT = K.paper('green_light', '#3F8A5E')
GOLD = K.paper('gold', '#E1B24A', rough=0.35, metal=0.7)
BRASS = K.paper('brass', '#C99A3E', rough=0.4, metal=0.8)
IRON = K.paper('iron', '#2A2624', rough=0.6, metal=0.4)
MUSTARD = K.paper('mustard', '#C99232', sheen=0.8)
PLAID = K.paper('plaid', '#B3313B', pattern=K.plaid('#2E5E45', '#B3313B', '#F1E4C8', 34.0))
PJ = K.paper('pyjamas', '#9CC3E6', pattern=K.stripes(['#9CC3E6', '#9CC3E6', '#F4F1EA'], 40.0, 'Z'))
SKIN = K.paper('skin', '#F2C3A2', fiber=0.04)
CHEEK = K.paper('cheek', '#EE9C8C', fiber=0.04)
HAIR = K.paper('hair', '#6A3A22')
INK = K.paper('ink', '#2B1E1A')
TEDDY = K.paper('teddy', '#B9834F')
CAT = K.paper('cat', '#E08A3C', pattern=K.stripes(['#E08A3C', '#E08A3C', '#C26A2B'], 26.0, 'X'))
CAT_WHITE = K.paper('cat_white', '#F7EBDC')
COOKIE = K.paper('cookie', '#D49A5A', pattern=K.dots('#D49A5A', '#4A2A18', 60.0, 0.12))
PLATE = K.paper('plate', '#F6F3EC', rough=0.4)
MILK = K.paper('milk', '#FBFBF7', rough=0.25)
SHADE = K.paper('lampshade', '#F3E2BE', emit='#FFCB7D', emit_strength=0.6)
CERAMIC = K.paper('ceramic', '#3E6F8E', rough=0.35)
CURTAIN = K.paper('curtain', '#8F1F2C', sheen=0.9)
SNOW = K.paper('snow', '#EAF1FF', fiber=0.05)
NIGHT_HILL = K.paper('night_hill', '#C9D8F2')
NIGHT_HILL2 = K.paper('night_hill2', '#A9BEE3')
NIGHT_SKY = K.paper('night_sky', '#1D2A5C', pattern=K.dots('#1D2A5C', '#F4EAC4', 90.0, 0.03))
HOUSE_A = K.paper('house_a', '#5E4A7A')
HOUSE_B = K.paper('house_b', '#3E5A86')
ROOF_SNOW = K.paper('roof_snow', '#F1F5FF')
BASKET = K.paper('basket', '#B58A52', pattern=K.stripes(['#B58A52', '#9B7342'], 50.0, 'Z'))
LOG = K.paper('log', '#6B4428', pattern=K.stripes(['#6B4428', '#5A3820'], 30.0, 'Z'))
RUG = K.paper('rug', '#B8343C')
STOCK_A = K.paper('stock_a', '#C42A3A', pattern=K.stripes(['#C42A3A', '#C42A3A', '#F4EEE2'], 22.0, 'Y'))
STOCK_B = K.paper('stock_b', '#2E6E4D', pattern=K.dots('#2E6E4D', '#F4EEE2', 40.0, 0.16))
STOCK_C = K.paper('stock_c', '#E2B34A', pattern=K.plaid('#2E5E45', '#C42A3A', '#E2B34A', 70.0))
GIFT_PAPERS = [
    K.paper('gift_a', '#2F6FB3', pattern=K.dots('#2F6FB3', '#F6F0E2', 40.0, 0.15)),
    K.paper('gift_b', '#C42A3A', pattern=K.stripes(['#C42A3A', '#F6F0E2'], 30.0, 'X')),
    K.paper('gift_c', '#2E7D5B', pattern=K.plaid('#2E7D5B', '#1F5A41', '#E9C76A', 50.0)),
    K.paper('gift_d', '#E9C35A', pattern=K.dots('#E9C35A', '#C42A3A', 36.0, 0.14)),
    K.paper('gift_e', '#7B4FA0', pattern=K.stripes(['#7B4FA0', '#9C73C2'], 26.0, 'Z')),
    K.paper('gift_f', '#F3EDE2', pattern=K.dots('#F3EDE2', '#2E6E4D', 30.0, 0.18)),
]
RIBBONS = [GOLD, RED, WHITE, GOLD, GREEN, RED]
TREE_GREENS = [K.paper('tree_a', '#2C6A4A'), K.paper('tree_b', '#3A8058'), K.paper('tree_c', '#25593F')]

# Light that bakes in, by group: the room (base), the fire, the tree's lights
FLAME = K.glow('flame', '#FF9A3C', 18.0)
FLAME['light_group'] = 'fire'
EMBER = K.glow('ember', '#FF5A1F', 10.0)
EMBER['light_group'] = 'fire'
CANDLE = K.glow('candle', '#FFC874', 14.0)
WINDOW_LIT = K.glow('window_lit', '#FFC66E', 6.0)
MOON = K.glow('moon', '#FFF4D4', 4.0)
BULB_COLOURS = ['#FFC46B', '#FF5B5B', '#6CFF93', '#6FB8FF', '#FFD9F2']
BULBS = []
for k, c in enumerate(BULB_COLOURS):
    m = K.glow(f'bulb_{k}', c, 22.0)
    m['light_group'] = 'tree'
    BULBS.append(m)
STAR_GLOW = K.glow('star_glow', '#FFE7A0', 20.0)
STAR_GLOW['light_group'] = 'tree'

# ---- The room ----

W, BACK, H, FRONT = HERO.ROOM_W, HERO.ROOM_BACK, HERO.ROOM_H, HERO.ROOM_FRONT
WIN_X, WIN_W, WIN_Z, WIN_H = HERO.WIN_X, HERO.WIN_W, HERO.WIN_Z, HERO.WIN_H
FX, FD, FW, FH = HERO.FIRE_X, 0.36, 1.7, 1.24

# Back wall, with the window cut out of it
back = K.box('back_wall', (W, 0.1, H), WALL, at=(0, BACK + 0.05, H / 2), bevel=0)
hole = K.box('cutter', (WIN_W, 0.6, WIN_H), WALL, at=(WIN_X, BACK, WIN_Z + WIN_H / 2), bevel=0, group='cutter')
bool_ = back.modifiers.new('window', 'BOOLEAN')
bool_.object = hole
bool_.operation = 'DIFFERENCE'
hole.hide_render = True
for x in (-W / 2, W / 2):
    K.box('side_wall', (0.1, BACK - FRONT, H), WALL, at=(x + (0.05 if x > 0 else -0.05), (BACK + FRONT) / 2, H / 2), bevel=0)
K.box('floor', (W, BACK - FRONT + 0.6, 0.06), FLOOR, at=(0, (BACK + FRONT) / 2 - 0.3, -0.03), bevel=0)
ceiling = K.box('ceiling', (W, BACK - FRONT + 0.6, 0.06), CEILING, at=(0, (BACK + FRONT) / 2 - 0.3, H + 0.03), bevel=0)
for k in range(5):
    K.box('beam', (W, 0.16, 0.18), WOOD_DARK, at=(0, BACK - 0.35 - k * 0.75, H - 0.09), bevel=0.012)
K.box('crown', (W, 0.08, 0.08), WAINSCOT, at=(0, BACK - 0.04, H - 0.04), bevel=0.01)

# Wainscot: cream panels below a wooden rail, on the back wall either side of the hearth
for x0, x1 in ((-W / 2, FX - 0.95), (FX + 0.95, W / 2)):
    cx, w = (x0 + x1) / 2, x1 - x0
    K.box('wainscot', (w, 0.03, 0.92), WAINSCOT, at=(cx, BACK - 0.015, 0.46), bevel=0.004)
    n = max(1, int(w / 0.5))
    for k in range(n):
        px = x0 + (k + 0.5) * w / n
        K.box('panel', (w / n - 0.1, 0.012, 0.56), WAINSCOT, at=(px, BACK - 0.035, 0.5), bevel=0.006)
    K.box('rail', (w, 0.05, 0.05), WOOD, at=(cx, BACK - 0.03, 0.94), bevel=0.01)
    K.box('skirting', (w, 0.04, 0.14), WOOD_DARK, at=(cx, BACK - 0.03, 0.07), bevel=0.008)
for x in (-W / 2 + 0.02, W / 2 - 0.02):
    K.box('side_wainscot', (0.03, BACK - FRONT, 0.92), WAINSCOT, at=(x, (BACK + FRONT) / 2, 0.46), bevel=0.004)
    K.box('side_rail', (0.05, BACK - FRONT, 0.05), WOOD, at=(x, (BACK + FRONT) / 2, 0.94), bevel=0.01)

# ---- The fireplace ----

FY = BACK - FD / 2
breast = K.box('fireplace', (FW, FD, FH), BRICK, at=(FX, FY, FH / 2), bevel=0.012)
arch = [(-0.42, 0)]
for k in range(13):
    a = math.pi * k / 12
    arch.append((-0.42 * math.cos(a), 0.52 + 0.2 * math.sin(a)))
arch.append((0.42, 0))
opening = K.cut('opening', arch, 0.8, BRICK, at=(FX, FY + 0.4, 0.0), rot=(math.pi / 2, 0, 0), group='cutter')
opening.hide_render = True
mod = breast.modifiers.new('opening', 'BOOLEAN')
mod.object = opening
mod.operation = 'DIFFERENCE'
breast.modifiers.move(1, 0)
# Inside: sooty brick, the back angled in
K.box('firebox_back', (0.86, 0.04, 0.74), SOOT, at=(FX, BACK - 0.03, 0.37), bevel=0)
for s in (-1, 1):
    K.box('firebox_side', (0.04, FD, 0.74), SOOT, at=(FX + s * 0.44, FY, 0.37), rot=(0, 0, s * 0.18), bevel=0)
K.box('firebox_floor', (0.9, FD, 0.04), SOOT, at=(FX, FY, 0.02), bevel=0)
# Chimney breast above the mantel, plastered
breast_upper = K.box('breast_upper', (1.5, 0.42, H - FH - 0.1), WALL, at=(FX, BACK - 0.21, FH + (H - FH) / 2 + 0.05), bevel=0.01)
K.box('hearth', (2.0, 0.55, 0.07), STONE, at=(FX, BACK - FD - 0.2, 0.035), bevel=0.012)
mantel = K.box('mantel', (2.05, 0.32, 0.08), WOOD, at=(FX, BACK - FD - 0.04, FH + 0.04), bevel=0.015)
# The flue: a shaft up from the firebox, through the breast and the ceiling and on up into the
# dark. Coming down the chimney, this is the way in.
SOOT_BRICK = K.paper('soot_brick', '#3A2A22', rough=1.0, pattern=K.bricks('#3D2B22', '#2E211B', '#18100C', 9.0))
# Right up into the chimney on the house's roof
FLUE_X, FLUE_Y, FLUE_W, FLUE_D, FLUE_TOP = HERO.FLUE_X, HERO.FLUE_Y, HERO.FLUE_W, HERO.FLUE_D, HERO.FLUE_TOP
flue_cut = K.box('flue_cut', (FLUE_W, FLUE_D, 3.0), WALL, at=(FLUE_X, FLUE_Y, 0.62 + 1.5), bevel=0, group='cutter')
flue_cut.hide_render = True
for host in (breast, breast_upper, ceiling, mantel):
    mod = host.modifiers.new('flue', 'BOOLEAN')
    mod.object = flue_cut
    mod.operation = 'DIFFERENCE'
lo = 0.6
for sx, sy, w, d in ((-1, 0, 0.04, FLUE_D + 0.08), (1, 0, 0.04, FLUE_D + 0.08), (0, -1, FLUE_W, 0.04), (0, 1, FLUE_W, 0.04)):
    K.box('flue_wall', (w, d, FLUE_TOP - lo), SOOT_BRICK,
          at=(FLUE_X + sx * (FLUE_W / 2 + 0.02), FLUE_Y + sy * (FLUE_D / 2 + 0.02), lo + (FLUE_TOP - lo) / 2), bevel=0)
K.box('mantel_lip', (1.95, 0.05, 0.12), WOOD, at=(FX, BACK - FD - 0.18, FH - 0.04), bevel=0.012)
for s in (-1, 1):
    K.box('corbel', (0.12, 0.16, 0.22), WOOD, at=(FX + s * 0.78, BACK - FD - 0.06, FH - 0.13), bevel=0.02)
# Logs, a grate, glowing embers
for k, (x, rz, r) in enumerate([(-0.12, 0.3, 0.055), (0.12, -0.25, 0.05), (0.0, 0.05, 0.045)]):
    K.cyl('log', r, 0.55, LOG, at=(FX + x - 0.27 * math.cos(rz), FY - 0.27 * math.sin(rz) * 0 + 0.0, 0.1 + k * 0.05), rot=(0, math.pi / 2, rz), seg=14)
K.box('ember_bed', (0.6, 0.24, 0.03), EMBER, at=(FX, FY, 0.06), bevel=0.01, group='fire_mesh')
for x in (-0.25, -0.12, 0.0, 0.12, 0.25):
    K.cyl('grate', 0.012, 0.3, IRON, at=(FX + x, FY - 0.12, 0.04), rot=(math.pi / 2, 0, 0), seg=8)
# Flames: three cards of flame crossed, for the bake; the app draws its own moving fire over them
flame = [(0, 0.5), (0.08, 0.3), (0.16, 0.12), (0.12, 0.0), (-0.12, 0.0), (-0.16, 0.14), (-0.07, 0.32)]
for k, rz in enumerate((0, 1.0, -1.0)):
    K.cut('flame', flame, 0.004, FLAME, at=(FX + (k - 1) * 0.12, FY, 0.12), rot=(math.pi / 2, 0, rz), group='fire_mesh')
K.light('fire', 'POINT', (FX, FY - 0.05, 0.35), 160, '#FF8A3D', size=0.25, group='fire')
K.light('fire_spill', 'AREA', (FX, FY - 0.45, 0.3), 60, '#FF7A30', size=0.6, rot=(math.radians(80), 0, 0), group='fire')

# Garland along the mantel: a sagging rope of paper needles and little stars, with lights
garland = []
for k in range(25):
    t = k / 24
    x = -1.0 + 2.0 * t
    sag = 0.12 * math.sin(math.pi * ((t * 3) % 1)) if True else 0
    garland.append((FX + x, BACK - FD - 0.26, FH + 0.03 - sag))
K.tube('garland_rope', garland, 0.035, GREEN)
for k, p in enumerate(garland):
    for j in range(3):
        o = K.cut('needle', K.star_outline(6, 0.05, 0.022), 0.004, GREEN_LIGHT if (k + j) % 2 else GREEN, EDGE_GREEN,
                  at=(p[0] + rnd.uniform(-0.03, 0.03), p[1] + rnd.uniform(-0.03, 0.03), p[2] + rnd.uniform(-0.03, 0.03)),
                  rot=(rnd.uniform(0, 3), rnd.uniform(0, 3), rnd.uniform(0, 3)))
    if k % 3 == 1:
        K.ball('berry', 0.016, RED, at=(p[0], p[1] - 0.04, p[2] - 0.02))

# Stockings: cut card socks with white cuffs, a name on each, hung on brass hooks
sock = [(0.0, 0.0), (0.16, 0.0), (0.16, -0.26), (0.24, -0.34), (0.26, -0.42), (0.2, -0.47), (0.04, -0.47),
        (-0.02, -0.42), (-0.01, -0.3)]
for k, (x, paper_, name) in enumerate(((-0.62, STOCK_A, 'MIA'), (-0.08, STOCK_B, 'LEO'), (0.46, STOCK_C, 'MAX'))):
    at = (FX + x, BACK - FD - 0.2, FH - 0.08)
    K.cut('stocking', sock, 0.04, paper_, EDGE, at=at, rot=(math.pi / 2, 0, rnd.uniform(-0.04, 0.04)), bevel=0.006)
    K.box('cuff', (0.2, 0.05, 0.08), WHITE, at=(at[0] + 0.08, at[1] - 0.005, at[2] - 0.02), bevel=0.012)
    K.text('name', name, 0.045, RED, at=(at[0] + 0.08, at[1] - 0.033, at[2] - 0.02), rot=(math.pi / 2, 0, 0), extrude=0.002)
    K.cyl('hook', 0.008, 0.06, BRASS, at=(at[0] + 0.08, at[1] + 0.02, FH - 0.03), rot=(math.pi / 2, 0, 0), seg=8)

# Candles in brass holders at either end, a little village of houses between
for s in (-1, 1):
    x = FX + s * 0.86
    K.cyl('holder', 0.05, 0.03, BRASS, at=(x, BACK - FD - 0.04, FH + 0.08))
    K.cyl('holder_stem', 0.018, 0.12, BRASS, at=(x, BACK - FD - 0.04, FH + 0.08))
    K.cyl('candle', 0.028, 0.2, CREAM, at=(x, BACK - FD - 0.04, FH + 0.2))
    K.cut('candle_flame', [(0, 0.06), (0.018, 0.02), (0.012, 0.0), (-0.012, 0.0), (-0.018, 0.02)], 0.003, CANDLE,
          at=(x, BACK - FD - 0.04, FH + 0.405), rot=(math.pi / 2, 0, 0), group='candle')
    K.light('candle_light', 'POINT', (x, BACK - FD - 0.1, FH + 0.45), 6, '#FFC874', size=0.03)
for k, (x, w, h, c) in enumerate(((-0.42, 0.14, 0.16, HOUSE_A), (-0.2, 0.12, 0.2, HOUSE_B), (0.25, 0.16, 0.15, HOUSE_A),
                                    (0.46, 0.11, 0.19, HOUSE_B))):
    at = (FX + x, BACK - FD - 0.02, FH + 0.08)
    K.box('mini_house', (w, 0.1, h), c, at=(at[0], at[1], at[2] + h / 2), bevel=0.004)
    roof = [(-w / 2 - 0.015, 0), (w / 2 + 0.015, 0), (0, w * 0.55)]
    K.cut('mini_roof', roof, 0.11, ROOF_SNOW, EDGE, at=(at[0], at[1] + 0.055, at[2] + h), rot=(math.pi / 2, 0, 0))
    K.box('mini_window', (w * 0.3, 0.01, h * 0.25), WINDOW_LIT, at=(at[0], at[1] - 0.052, at[2] + h * 0.55), bevel=0, group='static')

# A wreath on the chimney breast: paper leaves round a ring, a red bow, berries
WZ = 2.25
for k in range(60):
    a = 2 * math.pi * k / 60
    r = 0.24 + rnd.uniform(-0.035, 0.035)
    leaf = [(0, 0), (0.03, 0.04), (0.02, 0.09), (0, 0.11), (-0.02, 0.09), (-0.03, 0.04)]
    K.cut('wreath_leaf', leaf, 0.004, GREEN_LIGHT if k % 3 else GREEN, EDGE_GREEN,
          at=(FX + math.cos(a) * r, BACK - 0.43 - rnd.uniform(0, 0.03), WZ + math.sin(a) * r),
          rot=(math.pi / 2 + rnd.uniform(-0.4, 0.4), rnd.uniform(-0.4, 0.4), a + rnd.uniform(-0.6, 0.6)))
    if k % 5 == 0:
        K.ball('wreath_berry', 0.018, RED, at=(FX + math.cos(a + 0.05) * (r - 0.02), BACK - 0.46, WZ + math.sin(a + 0.05) * (r - 0.02)))
bow = [(0, 0), (0.12, 0.07), (0.14, -0.04), (0.02, -0.01), (0.09, -0.14), (0.04, -0.15), (0, -0.03), (-0.04, -0.15),
       (-0.09, -0.14), (-0.02, -0.01), (-0.14, -0.04), (-0.12, 0.07)]
K.cut('bow', bow, 0.02, RED, EDGE, at=(FX, BACK - 0.48, WZ - 0.22), rot=(math.pi / 2, 0, 0), bevel=0.004)

# ---- The tree ----

TX, TY = 0.95, 1.2
K.box('crate', (0.52, 0.52, 0.34), WOOD, at=(TX, TY, 0.17), bevel=0.012)
for k in range(3):
    K.box('crate_slat', (0.54, 0.02, 0.07), WOOD_DARK, at=(TX, TY - 0.265, 0.05 + k * 0.12), bevel=0.006)
K.cyl('trunk', 0.06, 0.4, LOG, at=(TX, TY, 0.3), seg=12)
LAYERS = 22
tips = []
for k in range(LAYERS):
    t = k / (LAYERS - 1)
    r = 0.72 * (1 - t) ** 1.05 + 0.07
    z = 0.48 + t * 1.95
    points = 11
    outline = K.star_outline(points, r, r * 0.66, rot=k * 0.37)
    o = K.cut('tree_layer', outline, 0.012, TREE_GREENS[k % 3], EDGE_GREEN, at=(TX, TY, z))
    # Droop the points of each layer, the way folded card sags
    for v in o.data.vertices:
        d = Vector((v.co.x, v.co.y)).length
        v.co.z -= (d / r) ** 2 * r * 0.22
    for j in range(points):
        a = k * 0.37 + 2 * math.pi * j / points + math.pi / 2
        tips.append((TX + math.cos(a) * r * 0.97, TY + math.sin(a) * r * 0.97, z - r * 0.22 - 0.01, k, r))
# Baubles, card stars and candy canes on the points
for k, (x, y, z, layer, r) in enumerate(tips):
    if y > TY + 0.25 or rnd.random() < 0.35:
        continue
    kind = rnd.random()
    if kind < 0.55:
        mat = rnd.choice([RED, GOLD, K.paper('blue_bauble', '#2F6FB3', rough=0.3), WHITE, GOLD])
        rr = 0.03 + 0.02 * rnd.random()
        K.ball('bauble', rr, mat, at=(x, y, z - rr - 0.01))
        K.cyl('cap', 0.01, 0.015, GOLD, at=(x, y, z - 0.012), seg=8)
    elif kind < 0.8:
        K.cut('tree_star', K.star_outline(5, 0.045, 0.02), 0.006, GOLD, EDGE, at=(x, y - 0.01, z - 0.05), rot=(math.pi / 2, 0, rnd.uniform(-0.4, 0.4)))
    else:
        cane = [(x, y, z - 0.12), (x, y, z - 0.02), (x + 0.02, y, z + 0.015), (x + 0.045, y, z - 0.005)]
        K.tube('cane', cane, 0.008, K.paper('cane', '#F6F0E6', pattern=K.stripes(['#F6F0E6', '#D2283B'], 60.0, 'Z')))
# The star on top: gold card, glowing at its heart
K.cut('topper', K.star_outline(5, 0.15, 0.065), 0.025, GOLD, EDGE, at=(TX, TY - 0.0, 2.6), rot=(math.pi / 2, 0, 0), bevel=0.004)
K.ball('topper_glow', 0.035, STAR_GLOW, at=(TX, TY - 0.03, 2.6), group='dynamic')
# Lights: a spiral of bulbs round the tree
bulbs = []
for k in range(110):
    t = k / 109
    a = t * 2 * math.pi * 6.5
    z = 0.5 + t * 1.95
    r = (0.72 * max(0.0, 1 - (z - 0.48) / 1.95) ** 1.05 + 0.07) * 0.86
    p = (TX + math.cos(a) * r, TY + math.sin(a) * r, z - 0.1)
    if p[1] > TY + 0.3:
        continue
    c = k % len(BULBS)
    K.ball(f'bulb_{c}', 0.016, BULBS[c], at=p, group='dynamic', seg=10)
    bulbs.append({'at': p, 'c': BULB_COLOURS[c]})
for k in range(4):
    K.light('tree_glow', 'POINT', (TX + rnd.uniform(-0.2, 0.2), TY - 0.35, 0.8 + k * 0.45), 18, BULB_COLOURS[k], size=0.2, group='tree')

# Presents under the tree: piled round the crate and out to the sides, a couple just inside the
# train's loop at the back; the middle of the loop is left clear (that's where ours sits down)
gifts = [(-0.68, -0.1, 0.28, 0.24, 0.2, 0.3), (-0.5, 0.12, 0.22, 0.2, 0.26, -0.2), (0.62, -0.08, 0.3, 0.26, 0.18, 0.15),
         (-0.38, -0.5, 0.18, 0.18, 0.14, 0.5), (0.48, 0.14, 0.16, 0.16, 0.12, 0.7), (0.82, -0.3, 0.2, 0.22, 0.16, -0.4),
         (0.42, -0.52, 0.17, 0.15, 0.13, 0.25), (-0.86, -0.32, 0.18, 0.2, 0.15, -0.6)]
for k, (x, y, w, d, h, rz) in enumerate(gifts):
    x, y = TX + x, TY + y
    k = k % len(GIFT_PAPERS)
    K.box('gift', (w, d, h), GIFT_PAPERS[k], at=(x, y, h / 2), rot=(0, 0, rz), bevel=0.008)
    rib = RIBBONS[k]
    K.box('ribbon', (w + 0.006, 0.03, h + 0.006), rib, at=(x, y, h / 2), rot=(0, 0, rz), bevel=0.002)
    K.box('ribbon', (0.03, d + 0.006, h + 0.006), rib, at=(x, y, h / 2), rot=(0, 0, rz), bevel=0.002)
    for s in (-1, 1):
        K.torus('bow_loop', 0.035, 0.009, rib, at=(x + s * 0.03 * math.cos(rz), y + s * 0.03 * math.sin(rz), h + 0.02),
                rot=(math.pi / 2, s * 0.5, rz))

# ---- The window, and the night outside ----

FR = WHITE
K.box('win_sill', (WIN_W + 0.2, 0.2, 0.05), WAINSCOT, at=(WIN_X, BACK - 0.05, WIN_Z - 0.02), bevel=0.01)
for s in (-1, 1):
    K.box('win_jamb', (0.06, 0.16, WIN_H), FR, at=(WIN_X + s * (WIN_W / 2 + 0.02), BACK + 0.02, WIN_Z + WIN_H / 2), bevel=0.006)
K.box('win_head', (WIN_W + 0.1, 0.16, 0.07), FR, at=(WIN_X, BACK + 0.02, WIN_Z + WIN_H + 0.02), bevel=0.006)
K.box('sill_snow', (WIN_W, 0.12, 0.03), SNOW, at=(WIN_X, BACK + 0.12, WIN_Z + 0.03), bevel=0.012)
# Two casements, hinged at the jambs, that swing out into the night when it's time to go
SASHES = []
for s_ in (-1, 1):
    group = 'sash_l' if s_ < 0 else 'sash_r'
    hinge = (WIN_X + s_ * WIN_W / 2, BACK + 0.06, WIN_Z)
    cx = WIN_X + s_ * WIN_W / 4
    half = WIN_W / 2
    for (bx, bz, bw, bh) in ((cx, WIN_Z + 0.02, half, 0.04), (cx, WIN_Z + WIN_H - 0.02, half, 0.04),
                             (WIN_X + s_ * 0.02, WIN_Z + WIN_H / 2, 0.04, WIN_H), (WIN_X + s_ * (half - 0.02), WIN_Z + WIN_H / 2, 0.04, WIN_H),
                             (cx, WIN_Z + WIN_H * 0.36, half, 0.03), (cx, WIN_Z + WIN_H * 0.7, half, 0.03)):
        K.box('sash', (bw, 0.045, bh), FR, at=(bx, BACK + 0.06, bz), bevel=0.004, group=group)
    # A paper snowflake stuck to each
    flake = []
    for j in range(24):
        a_ = math.pi * 2 * j / 24
        rr = 0.06 * (1.0 if j % 4 == 0 else 0.45 if j % 2 else 0.62)
        flake.append((math.cos(a_) * rr, math.sin(a_) * rr))
    K.cut('snowflake', flake, 0.003, WHITE, at=(cx, BACK + 0.035, WIN_Z + WIN_H * (0.53 if s_ < 0 else 0.18)), rot=(math.pi / 2, 0, 0),
          group=group)
    SASHES.append((group, hinge, s_))
# Curtains: velvet hanging in folds, tied back
for s in (-1, 1):
    bm = bmesh.new()
    cols, rows = 24, 30
    grid = []
    for j in range(rows + 1):
        row = []
        for i in range(cols + 1):
            u, v = i / cols, j / rows
            tie = 1 - 0.5 * math.exp(-((v - 0.35) / 0.12) ** 2)
            x = (u * 0.38 + 0.02) * (tie if v < 0.95 else 1)
            y = 0.035 * math.sin(u * math.pi * 7) * (0.6 + 0.4 * v)
            row.append(bm.verts.new((s * (WIN_W / 2 - 0.12 + x) + WIN_X, BACK - 0.1 + y, WIN_Z - 0.35 + v * (WIN_H + 0.6))))
        grid.append(row)
    for j in range(rows):
        for i in range(cols):
            f = bm.faces.new((grid[j][i], grid[j][i + 1], grid[j + 1][i + 1], grid[j + 1][i]))
            f.smooth = True
    o = K.mesh_obj('curtain', bm, [CURTAIN])
    sol = o.modifiers.new('solid', 'SOLIDIFY')
    sol.thickness = 0.012
    K.cyl('tieback', 0.025, 0.2, GOLD, at=(WIN_X + s * (WIN_W / 2 - 0.02), BACK - 0.12, WIN_Z + 0.08), seg=10)
K.box('valance', (WIN_W + 0.5, 0.12, 0.2), CURTAIN, at=(WIN_X, BACK - 0.08, WIN_Z + WIN_H + 0.2), bevel=0.03)
K.cyl('rod', 0.018, WIN_W + 0.6, BRASS, at=(WIN_X - (WIN_W + 0.6) / 2, BACK - 0.1, WIN_Z + WIN_H + 0.32), rot=(0, math.pi / 2, 0), seg=10)
K.light('moonlight', 'AREA', (WIN_X + 0.3, BACK + 1.0, WIN_Z + 1.6), 160, '#9EB6FF', size=0.9,
        rot=(math.radians(-60), 0, math.radians(15)))

# ---- The armchair and the lamp, off to the side ----

CX, CY, CR = -1.55, -0.35, 0.75
chair = []
chair.append(K.box('chair_seat', (0.82, 0.72, 0.22), MUSTARD, at=(0, 0, 0.36), bevel=0.06, segments=4))
chair.append(K.box('chair_back', (0.82, 0.2, 0.62), MUSTARD, at=(0, 0.32, 0.72), rot=(-0.12, 0, 0), bevel=0.07, segments=4))
for s in (-1, 1):
    chair.append(K.box('chair_arm', (0.16, 0.72, 0.3), MUSTARD, at=(s * 0.4, 0.0, 0.55), bevel=0.07, segments=4))
    for fy in (-0.3, 0.3):
        chair.append(K.cyl('chair_leg', 0.025, 0.25, WOOD_DARK, at=(s * 0.34, fy, 0.0), r2=0.018, seg=10))
chair.append(K.box('blanket', (0.7, 0.5, 0.03), PLAID, at=(0.05, -0.05, 0.6), rot=(0.25, 0.1, 0.1), bevel=0.012))
pivot = bpy.data.objects.new('chair_pivot', None)
bpy.context.scene.collection.objects.link(pivot)
pivot.location = (CX, CY, 0)
pivot.rotation_euler = (0, 0, CR)
# Turn the whole chair toward the fire
for o in chair:
    o.parent = pivot
# Side table and lamp
LX, LY = -1.75, 0.1
K.cyl('table_top', 0.22, 0.03, WOOD, at=(LX, LY, 0.62), seg=32, bevel=0.008)
K.cyl('table_leg', 0.03, 0.6, WOOD_DARK, at=(LX, LY, 0.02), seg=12)
K.cyl('table_foot', 0.15, 0.025, WOOD_DARK, at=(LX, LY, 0.0), seg=24)
K.ball('lamp_base', 0.09, CERAMIC, at=(LX, LY, 0.75), scale=(1, 1, 1.1))
K.cyl('lamp_stem', 0.012, 0.22, BRASS, at=(LX, LY, 0.82), seg=8)
K.cyl('lamp_shade', 0.17, 0.2, SHADE, at=(LX, LY, 0.95), r2=0.1, seg=36, caps=False)
K.light('lamp', 'POINT', (LX, LY, 1.02), 45, '#FFC27A', size=0.06)
# Books stacked under the table
for k in range(3):
    K.box('book', (0.24 - k * 0.02, 0.17, 0.045), [RED, GREEN, K.paper('book_b', '#2F6FB3')][k], at=(LX, LY, 0.03 + k * 0.047), rot=(0, 0, k * 0.2), bevel=0.006)

# ---- The child, asleep on the rug by the tree in a Santa hat, the bear in one arm ----

KX, KY, KR = -0.02, 0.18, -0.1
NIGHTCAP = K.paper('nightcap', '#C42A3A')
kid = []
kid.append(K.box('pillow', (0.34, 0.24, 0.09), RED_DEEP, at=(-0.36, 0.03, 0.05), bevel=0.04, segments=4))
kid.append(K.metaballs('child', [
    ('ball', (-0.34, 0.0, 0.18), 0.105, 'skin'),
    ('ellipsoid', (-0.38, 0.035, 0.2), (0.1, 0.095, 0.105), 'hair'),
    ('ellipsoid', (-0.12, 0.0, 0.13), (0.2, 0.15, 0.11), 'blanket'),
    ('ellipsoid', (0.06, 0.0, 0.12), (0.2, 0.15, 0.1), 'blanket'),
    ('ellipsoid', (0.24, 0.0, 0.095), (0.14, 0.13, 0.08), 'blanket'),
], {'skin': SKIN, 'hair': HAIR, 'blanket': PLAID}, resolution=0.01))
# The blanket's turned-down edge, under the chin
kid.append(K.box('blanket_fold', (0.05, 0.27, 0.05), CREAM, at=(-0.23, -0.01, 0.17), rot=(0, 0.3, 0), bevel=0.02))
# Lying on one side: the face's up is toward -x, so the eyes sit one above the other
for ez in (0.21, 0.15):
    kid.append(K.tube('eye', [(-0.395, -0.101, ez - 0.018), (-0.385, -0.106, ez), (-0.395, -0.101, ez + 0.018)], 0.0045, INK))
kid.append(K.ball('cheek', 0.02, CHEEK, at=(-0.355, -0.098, 0.12)))
kid.append(K.ball('nose', 0.012, SKIN, at=(-0.335, -0.105, 0.18)))
kid.append(K.tube('smile', [(-0.3, -0.1, 0.205), (-0.292, -0.103, 0.18), (-0.3, -0.1, 0.155)], 0.003, INK))
# A Santa hat, slipping off
hat = [(-0.42, 0.0, 0.27), (-0.5, 0.0, 0.3), (-0.58, -0.02, 0.27), (-0.62, -0.05, 0.2)]
kid.append(K.tube('nightcap', hat, 0.075, NIGHTCAP, taper=[1, 0.7, 0.42, 0.2]))
kid.append(K.torus('cap_band', 0.085, 0.024, WHITE, at=(-0.415, 0.0, 0.265), rot=(0, math.pi / 2 - 0.5, 0)))
kid.append(K.ball('cap_pom', 0.035, WHITE, at=(-0.63, -0.05, 0.18)))
# One hand out from under the blanket, holding the bear
kid.append(K.ball('hand', 0.03, SKIN, at=(-0.2, -0.13, 0.14)))
kid.append(K.metaballs('teddy', [
    ('ball', (-0.12, -0.2, 0.08), 0.07, 't'),
    ('ball', (-0.12, -0.21, 0.19), 0.058, 't'),
    ('ball', (-0.165, -0.2, 0.235), 0.024, 't'),
    ('ball', (-0.075, -0.2, 0.235), 0.024, 't'),
    ('ellipsoid', (-0.12, -0.26, 0.18), (0.028, 0.02, 0.022), 'm'),
    ('ellipsoid', (-0.12, -0.265, 0.08), (0.04, 0.02, 0.045), 'm'),
], {'t': TEDDY, 'm': CREAM}, resolution=0.008))
for ex in (-0.14, -0.1):
    kid.append(K.ball('teddy_eye', 0.008, INK, at=(ex, -0.258, 0.2)))
kid.append(K.ball('teddy_nose', 0.009, INK, at=(-0.12, -0.282, 0.182)))
kid_pivot = bpy.data.objects.new('kid_pivot', None)
bpy.context.scene.collection.objects.link(kid_pivot)
kid_pivot.location = (KX, KY, 0.016)
kid_pivot.rotation_euler = (0, 0, KR)
kid_pivot.scale = (1.3, 1.3, 1.3)
for o in kid:
    o.parent = kid_pivot

# ---- Milk and cookies for Santa, on the hearth ----

PX, PY = FX + 0.66, BACK - FD - 0.26
K.cyl('plate', 0.12, 0.012, PLATE, at=(PX, PY, 0.07), seg=40, bevel=0.004)
K.torus('plate_rim', 0.11, 0.004, K.paper('rim', '#3A6FB0'), at=(PX, PY, 0.083))
for k in range(4):
    a = k * 1.7
    K.cyl('cookie', 0.045, 0.012, COOKIE, at=(PX + math.cos(a) * 0.05, PY + math.sin(a) * 0.05, 0.082 + k * 0.006), seg=24, bevel=0.004)
K.cyl('glass', 0.035, 0.13, MILK, at=(PX + 0.18, PY + 0.03, 0.07), seg=24)
note = [(-0.07, 0), (0.07, 0), (0.07, 0.09), (-0.07, 0.09)]
K.cut('note', note, 0.002, CREAM, at=(PX - 0.17, PY - 0.01, 0.07), rot=(math.pi / 2 - 0.25, 0, 0.3))
K.text('note_text', 'For\nSanta', 0.028, INK, at=(PX - 0.17, PY - 0.024, 0.115), rot=(math.pi / 2 - 0.25, 0, 0.3), extrude=0.0006)
# Firewood in a basket by the fire
K.cyl('basket', 0.2, 0.3, BASKET, at=(FX - 1.05, BACK - 0.4, 0.0), seg=28, r2=0.23, caps=True)
for k in range(5):
    K.cyl('firewood', 0.04, 0.5, LOG, at=(FX - 1.2 + k * 0.07, BACK - 0.4 - 0.1 + (k % 2) * 0.12, 0.28), rot=(0.4, 0.1 * k, 0.3 * k), seg=10)

# ---- The rug and the cat asleep on it ----

rug = K.cut('rug', K.circle_outline(0.95, 64, sx=1.0, sy=0.62), 0.012, K.paper('rug_print', '#B8343C', pattern=K.stripes(
    ['#B8343C', '#F0E2C6', '#2E6E4D', '#F0E2C6'], 9.0, 'X')), EDGE, at=(0.1, 0.55, 0.002))
K.cut('rug_inner', K.circle_outline(0.62, 64, sx=1.0, sy=0.62), 0.004, K.paper('rug_mid', '#F0E2C6', pattern=K.dots('#F0E2C6', '#B8343C', 30.0, 0.16)), EDGE, at=(0.1, 0.55, 0.014))
cat = K.metaballs('cat', [
    ('ellipsoid', (0.0, 0.0, 0.11), (0.25, 0.18, 0.11), 'cat'),
    ('ellipsoid', (-0.1, 0.02, 0.12), (0.14, 0.16, 0.11), 'cat'),
    ('ball', (0.21, -0.08, 0.15), 0.1, 'cat'),
    ('ellipsoid', (0.24, -0.16, 0.12), (0.06, 0.045, 0.045), 'white'),
    ('ellipsoid', (0.08, -0.15, 0.07), (0.16, 0.05, 0.05), 'white'),
    ('ellipsoid', (0.2, -0.17, 0.04), (0.08, 0.05, 0.03), 'white'),
], {'cat': CAT, 'white': CAT_WHITE}, resolution=0.01)
cat.location = (FX - 0.62, 0.92, 0.016)
cat.rotation_euler = (0, 0, -0.35)
for s_ in (-1, 1):
    ear = K.cut('cat_ear', [(-0.04, 0), (0.04, 0), (0.005, 0.075)], 0.014, CAT, EDGE,
                at=(0.21 + s_ * 0.055, -0.06, 0.225), rot=(math.pi / 2 - 0.25, 0, s_ * 0.2))
    ear.parent = cat
    inner = K.cut('cat_ear_in', [(-0.022, 0), (0.022, 0), (0.003, 0.045)], 0.004, K.paper('ear_pink', '#F2A7A0'), EDGE,
                  at=(0.21 + s_ * 0.055, -0.072, 0.232), rot=(math.pi / 2 - 0.25, 0, s_ * 0.2))
    inner.parent = cat
    eye = K.tube('cat_eye', [(0.19 + s_ * 0.04, -0.176, 0.165), (0.2 + s_ * 0.04, -0.183, 0.158), (0.21 + s_ * 0.04, -0.176, 0.165)], 0.0045, INK)
    eye.parent = cat
nose = K.ball('cat_nose', 0.012, K.paper('nose_pink', '#E07C7C'), at=(0.25, -0.2, 0.135))
nose.parent = cat
tail = K.tube('cat_tail', [(-0.26, 0.04, 0.08), (-0.27, -0.12, 0.06), (-0.1, -0.24, 0.05), (0.1, -0.24, 0.045)], 0.034, CAT, taper=[1, 1, 0.9, 0.7])
tail.parent = cat

# ---- A toy train on its track round the front of the tree ----

# A wide loop in front of the tree, room in the middle of it for a present to sit
TRX, TRY, TRA, TRB = TX + 0.12, 0.52, 0.88, 0.38
track = []
for k in range(97):
    a = 2 * math.pi * k / 96
    track.append((TRX + math.cos(a) * TRA, TRY + math.sin(a) * TRB, 0.018))
for off in (-0.022, 0.022):
    pts = []
    for k in range(97):
        a = 2 * math.pi * k / 96
        pts.append((TRX + math.cos(a) * (TRA + off), TRY + math.sin(a) * (TRB + off), 0.022))
    K.tube('rail', pts, 0.005, IRON, caps=False)
for k in range(64):
    a = 2 * math.pi * k / 64
    # Square across the track: along the ellipse's normal there
    K.box('sleeper', (0.07, 0.016, 0.008), WOOD_DARK, at=(TRX + math.cos(a) * TRA, TRY + math.sin(a) * TRB, 0.014),
          rot=(0, 0, math.atan2(math.sin(a) * TRA, math.cos(a) * TRB)), bevel=0)
TRAIN_RED = K.paper('train_red', '#C42A3A', rough=0.5)
TRAIN_GREEN = K.paper('train_green', '#2E6E4D', rough=0.5)
TRAIN_BLACK = K.paper('train_black', '#1F1B1A', rough=0.5)


def carriage(name, body, roof, length, chimney=False):
    parts = [K.box(name, (0.07, length, 0.06), body, at=(0, 0, 0.065), bevel=0.008, group='train')]
    parts.append(K.box(name + '_roof', (0.08, length + 0.01, 0.012), roof, at=(0, 0, 0.1), bevel=0.004, group='train'))
    for fy in (-length * 0.3, length * 0.3):
        for s_ in (-1, 1):
            parts.append(K.cyl(name + '_wheel', 0.018, 0.012, TRAIN_BLACK, at=(s_ * 0.042, fy, 0.028), rot=(0, math.pi / 2, 0), seg=14, group='train'))
    if chimney:
        parts.append(K.cyl(name + '_boiler', 0.032, length * 0.6, TRAIN_BLACK, at=(0, length * 0.05, 0.075), rot=(-math.pi / 2, 0, 0), seg=16, group='train'))
        parts.append(K.cyl(name + '_stack', 0.014, 0.05, TRAIN_BLACK, at=(0, length * 0.35, 0.1), r2=0.02, seg=12, group='train'))
        parts.append(K.ball(name + '_lamp', 0.012, K.glow('train_lamp', '#FFE3A0', 8.0), at=(0, length * 0.5 + 0.005, 0.07), group='train'))
    return parts


TRAIN = {
    'engine': carriage('engine', TRAIN_RED, TRAIN_BLACK, 0.16, chimney=True),
    'car_a': carriage('car_a', TRAIN_GREEN, TRAIN_RED, 0.13),
    'car_b': carriage('car_b', TRAIN_RED, TRAIN_GREEN, 0.13),
}
for parts in TRAIN.values():
    for o in parts:
        o.hide_render = True

# ---- Up high: bunting, a string of lights across the wall, paper stars on threads ----

LETTERS = 'MERRY CHRISTMAS'
for k, ch in enumerate(LETTERS):
    t = k / (len(LETTERS) - 1)
    x = -1.35 + 2.7 * t
    z = 2.85 - 0.22 * math.sin(math.pi * t)
    if ch == ' ':
        continue
    flag = [(-0.08, 0), (0.08, 0), (0, -0.17)]
    mat = [RED, CREAM, GREEN][k % 3]
    K.cut('pennant', flag, 0.003, mat, EDGE, at=(x, BACK - 0.5, z), rot=(math.pi / 2, 0, 0))
    K.text('letter', ch, 0.075, CREAM if mat is not CREAM else RED, at=(x, BACK - 0.505, z - 0.055), rot=(math.pi / 2, 0, 0), extrude=0.001)
K.tube('bunting_string', [(-1.45, BACK - 0.5, 2.86), (0, BACK - 0.5, 2.62), (1.45, BACK - 0.5, 2.86)], 0.004, CREAM)
swag = []
for k in range(41):
    t = k / 40
    x = -2.2 + 4.4 * t
    swag.append((x, BACK - 0.1, H - 0.25 - 0.2 * abs(math.sin(math.pi * t * 3))))
K.tube('light_string', swag, 0.004, INK)
for k, p in enumerate(swag):
    if k % 1 == 0:
        c = k % len(BULBS)
        K.ball(f'bulb_{c}', 0.014, BULBS[0] if k % 2 else BULBS[c], at=(p[0], p[1] - 0.01, p[2] - 0.02), group='dynamic', seg=10)
        bulbs.append({'at': (p[0], p[1] - 0.01, p[2] - 0.02), 'c': BULB_COLOURS[0] if k % 2 else BULB_COLOURS[c]})
hanging = [(-0.85, -0.2, 2.35, GOLD), (0.55, -0.6, 2.5, CREAM), (-0.25, 0.4, 2.55, GOLD), (0.95, 0.3, 2.3, CREAM),
           (-1.5, -0.6, 2.45, GOLD)]
for x, y, z, mat in hanging:
    K.tube('thread', [(x, y, H), (x, y, z + 0.1)], 0.0015, CREAM)
    K.cut('hang_star', K.star_outline(5, 0.1, 0.045), 0.008, mat, EDGE, at=(x, y, z), rot=(math.pi / 2, 0, rnd.uniform(-0.6, 0.6)))

# ---- World light, camera ----

world = bpy.data.worlds.new('night')
scene.world = world
world.use_nodes = True
world.node_tree.nodes['Background'].inputs['Color'].default_value = K.lin('#1A2042')
world.node_tree.nodes['Background'].inputs['Strength'].default_value = 0.3
world['strength'] = 0.3

cam = bpy.data.objects.new('camera', bpy.data.cameras.new('camera'))
scene.collection.objects.link(cam)
cam.location = (0.0, -3.3, 1.2)
target = bpy.data.objects.new('target', None)
scene.collection.objects.link(target)
target.location = (0.1, 1.6, 1.32)
c = cam.constraints.new('TRACK_TO')
c.target = target
cam.data.sensor_fit = 'VERTICAL'
cam.data.angle = math.radians(58)
scene.camera = cam
scene.render.resolution_x = 540
scene.render.resolution_y = 1170

if MODE == 'preview' and len(args) > 2 and args[2] == 'tree':
    # Down on the train's loop and the presents round the tree
    cam.location = (0.4, -1.1, 1.3)
    target.location = (1.0, 0.7, 0.15)
    cam.data.angle = math.radians(50)
    scene.render.resolution_x, scene.render.resolution_y = 1000, 760
if MODE == 'preview':
    scene.cycles.samples = 160
    scene.cycles.use_denoising = True
    scene.render.filepath = OUT
    bpy.ops.render.render(write_still=True)
    print('rendered', OUT)

if MODE == 'bake':
    import numpy as np

    os.makedirs(OUT, exist_ok=True)
    # Everything still gives and takes the light, but only the static room is baked into
    statics = K.flatten('static')
    for o in [o for o in scene.objects if o.get('group') == 'cutter']:
        bpy.data.objects.remove(o)
    room = K.join(statics, 'room')
    print('room faces', len(room.data.polygons))
    K.lightmap_uv(room, margin=0.0025)
    ALB, LIT = 4096, 2048
    _, colour = K.bake(room, 'COLOR', ALB, 4, 'albedo', groups=['base'])
    colour = K.pushpull(colour, colour[..., 3] > 0)
    K.save_png(K.linear_to_srgb(colour), os.path.join(OUT, 'room_albedo.jpg'))
    _, emit = K.bake(room, 'EMIT', 1024, 1, 'emit', groups=['base'])
    K.save_png(K.linear_to_srgb(emit), os.path.join(OUT, 'room_emit.jpg'))
    layers = {}
    for name, groups, world_on in (('base', ['base'], True), ('fire', ['fire'], False), ('tree', ['tree'], False)):
        _, px = K.bake(room, 'LIGHT', LIT, 384, name, groups=groups, world_on=world_on)
        px = K.denoise(px, px[..., 3] > 0, r=2)
        lit = px[..., :3][px[..., 3] > 0]
        scale = max(0.05, float(np.percentile(lit, 99.5)))
        layers[name] = round(scale, 4)
        px = K.pushpull(px, px[..., 3] > 0)
        K.save_png(px, os.path.join(OUT, f'room_{name}.png'), scale=scale, gamma=2.0)
        print('light', name, 'scale', scale)
    data = {'room': K.pack_baked(room), 'light': layers}
    # Things that move or glow on their own
    data['bulbs'] = [{'at': K.three(b['at']), 'c': b['c']} for b in bulbs]
    data['topper'] = K.three((TX, TY - 0.03, 2.6))
    data['candles'] = [K.three((FX + s_ * 0.86, BACK - FD - 0.04, FH + 0.43)) for s_ in (-1, 1)]
    data['fire'] = {'at': K.three((FX, FY - 0.02, 0.1)), 'w': 0.6, 'h': 0.55}
    data['train'] = {'centre': K.three((TRX, TRY, 0.0)), 'a': TRA, 'b': TRB,
                     'cars': {k: K.pack_lit(K.flatten_list(v)) for k, v in TRAIN.items()}}
    data['gift'] = K.three((TRX, TRY - 0.1, 0.0))
    data['milk'] = K.three((PX + 0.18, PY + 0.03, 0.07))
    data['cookies'] = K.three((PX, PY, 0.09))
    data['camera'] = {'at': K.three(cam.location), 'look': K.three(target.location), 'fov': 58}
    data['flue'] = {'top': K.three((FLUE_X, FLUE_Y, FLUE_TOP - 0.4)), 'bottom': K.three((FLUE_X, FLUE_Y, 0.45))}
    data['kid'] = K.three((KX - 0.44, KY, 0.26))
    data['window'] = {
        'at': K.three((WIN_X, BACK, WIN_Z + WIN_H / 2)),
        'sashes': [{'hinge': K.three(h), 'side': s_, 'mesh': K.pack_lit(K.flatten(g), pivot=h)} for g, h, s_ in SASHES],
    }
    # Where the room goes in the town: turned half round about y, then moved
    data['place'] = {'at': K.three(HERO.ROOM_AT), 'turn': HERO.ROOM_TURN}
    # Out of the fireplace: where you land coming down the chimney, looking out into the room
    data['hearth'] = {'at': K.three((FX, BACK - 0.12, 0.45)), 'look': K.three((FX + 0.2, -1.0, 0.9))}
    K.write_json(os.path.join(OUT, 'room.json'), data)
