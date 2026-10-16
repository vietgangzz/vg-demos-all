"""
Bakes the maps the Fairy Globe is built from, out of the hand-drawn outlines in world_outlines.py:

  world_shape.png  R  distance to the coast, signed (inland up): 0.5 + degrees / 16, so ±8°
                   G  how high the land stands: a low plateau, ranges, the ice domes
                   B  where people live: the lights on the night side
  world_color.png  the land painted for Christmas Eve: snow over the north, green summer in the
                   south, sand, jungle, rock. Spread out past the coasts so filtering never pulls
                   in a seam of sea
  world_life.png   what grows where: R pines, G round trees, B palms

All three are equirectangular, north up, longitude -180 at the left edge.

Run headless (Blender ships numpy):
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/fairy_globe_world.py -- <out dir>
"""

import math
import os
import sys

import bpy
import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from world_outlines import DESERTS, JUNGLES, LAND, MOUNTAINS, PEOPLE, WATER  # noqa: E402

OUT = sys.argv[sys.argv.index('--') + 1] if '--' in sys.argv else os.path.abspath('assets/fairy-globe')
os.makedirs(OUT, exist_ok=True)
W, H = 2048, 1024
rng = np.random.default_rng(24)


def grid(w, h):
    lon = (np.arange(w) + 0.5) / w * 360 - 180
    lat = 90 - (np.arange(h) + 0.5) / h * 180
    return np.meshgrid(lon, lat)


def unit(lon, lat):
    lo, la = np.radians(lon), np.radians(lat)
    return np.stack([np.cos(la) * np.sin(lo), np.sin(la), np.cos(la) * np.cos(lo)], -1)


# ---- Outlines to a mask ----

def raster(poly, w, h):
    """Even-odd scanline fill of one outline, drawn again a turn either side so it wraps"""
    mask = np.zeros((h, w), bool)
    pts = np.array(poly, float)
    for shift in (-360, 0, 360):
        xs = (pts[:, 0] + shift + 180) / 360 * w
        if xs.max() < 0 or xs.min() > w:
            continue
        ys = (90 - pts[:, 1]) / 180 * h
        x0, y0 = xs, ys
        x1, y1 = np.roll(xs, -1), np.roll(ys, -1)
        lo, hi = max(0, int(ys.min())), min(h, int(math.ceil(ys.max())) + 1)
        for j in range(lo, hi):
            yc = j + 0.5
            hit = ((y0 <= yc) & (y1 > yc)) | ((y1 <= yc) & (y0 > yc))
            if not hit.any():
                continue
            t = (yc - y0[hit]) / (y1[hit] - y0[hit])
            xi = np.sort(x0[hit] + t * (x1[hit] - x0[hit]))
            for a, b in zip(xi[0::2], xi[1::2]):
                ia, ib = max(0, int(math.ceil(a - 0.5))), min(w - 1, int(math.floor(b - 0.5)))
                if ib >= ia:
                    mask[j, ia:ib + 1] ^= True
    return mask


land = np.zeros((H, W), bool)
for name, poly in LAND.items():
    land |= raster(poly, W, H)
for name, poly in WATER.items():
    land &= ~raster(poly, W, H)
print('land', land.mean())

# ---- Signed distance to the coast, by jump flooding on the sphere ----

lon2, lat2 = grid(W, H)
P = unit(lon2, lat2).astype(np.float32)
left = np.roll(land, 1, 1)
right = np.roll(land, -1, 1)
up = np.vstack([land[:1], land[:-1]])
down = np.vstack([land[1:], land[-1:]])
edge = (land != left) | (land != right) | (land != up) | (land != down)
jj, ii = np.indices((H, W))
sx = np.where(edge, ii, -1).astype(np.int32)
sy = np.where(edge, jj, -1).astype(np.int32)


def chord(sx_, sy_):
    ok = sx_ >= 0
    d = np.full((H, W), 9.0, np.float32)
    q = P[np.clip(sy_, 0, H - 1), np.clip(sx_, 0, W - 1)]
    d[ok] = ((P - q) ** 2).sum(-1)[ok]
    return d


best = chord(sx, sy)
k = W // 2
while k >= 1:
    for dy in (-k, 0, k):
        for dx in (-k, 0, k):
            if dx == 0 and dy == 0:
                continue
            cx = np.roll(sx, (-dy, -dx), (0, 1))
            cy = np.roll(sy, (-dy, -dx), (0, 1))
            # Rows don't wrap: north of the pole isn't the south pole
            if dy > 0:
                cx[H - dy:] = -1
            elif dy < 0:
                cx[:-dy] = -1
            d = chord(cx, cy)
            take = d < best
            best[take] = d[take]
            sx[take] = cx[take]
            sy[take] = cy[take]
    k //= 2
dist = np.degrees(2 * np.arcsin(np.clip(np.sqrt(best) / 2, 0, 1)))
sd = np.where(land, dist, -dist)


def blur(a, r):
    """Box blur three times over: close to a gaussian. Wraps east-west."""
    for _ in range(3):
        c = np.cumsum(np.concatenate([a[:, -r:], a, a[:, :r]], 1), 1)
        a = (c[:, 2 * r:] - np.concatenate([np.zeros((a.shape[0], 1)), c[:, :-2 * r - 1]], 1)[:, :a.shape[1]]) / (2 * r + 1)
        pad = np.concatenate([np.repeat(a[:1], r, 0), a, np.repeat(a[-1:], r, 0)], 0)
        c = np.cumsum(pad, 0)
        a = (c[2 * r:] - np.concatenate([np.zeros((1, a.shape[1])), c[:-2 * r - 1]], 0)[:a.shape[0]]) / (2 * r + 1)
    return a


sd = blur(sd, 1)
print('sdf done')

# ---- Noise ----


def value_noise(w, h, cells, seed):
    g = np.random.default_rng(seed).random((cells // 2 + 2, cells + 1))
    g[:, -1] = g[:, 0]
    y = np.linspace(0, cells // 2, h, endpoint=False) + 0.5 * (cells / 2) / h
    x = np.linspace(0, cells, w, endpoint=False)
    xi, yi = x.astype(int), y.astype(int)
    xf, yf = x - xi, y - yi
    xf, yf = xf * xf * (3 - 2 * xf), yf * yf * (3 - 2 * yf)
    a = g[yi][:, xi]
    b = g[yi][:, xi + 1]
    c = g[yi + 1][:, xi]
    d = g[yi + 1][:, xi + 1]
    top = a + (b - a) * xf[None]
    bot = c + (d - c) * xf[None]
    return top + (bot - top) * yf[:, None]


def fbm(w, h, base, octaves, seed):
    total, amp, norm = 0, 1.0, 0
    for o in range(octaves):
        total = total + value_noise(w, h, base * 2 ** o, seed + o) * amp
        norm += amp
        amp *= 0.5
    return total / norm


def upsample(a, w, h):
    y = (np.arange(h) + 0.5) / h * a.shape[0] - 0.5
    x = (np.arange(w) + 0.5) / w * a.shape[1] - 0.5
    y0 = np.clip(np.floor(y).astype(int), 0, a.shape[0] - 1)
    y1 = np.clip(y0 + 1, 0, a.shape[0] - 1)
    x0 = np.floor(x).astype(int) % a.shape[1]
    x1 = (x0 + 1) % a.shape[1]
    fy = np.clip(y - y0, 0, 1)[:, None]
    fx = (x - np.floor(x))[None]
    return (a[y0][:, x0] * (1 - fx) + a[y0][:, x1] * fx) * (1 - fy) + (a[y1][:, x0] * (1 - fx) + a[y1][:, x1] * fx) * fy


def smooth(a, b, x):
    t = np.clip((x - a) / (b - a), 0, 1)
    return t * t * (3 - 2 * t)


# ---- Heights, at half size ----

w2, h2 = W // 2, H // 2
lon_h, lat_h = grid(w2, h2)
sd_h = sd[::2, ::2]
coslat = np.cos(np.radians(lat_h))


def ridge_distance(pts):
    """Degrees from every pixel to a ridgeline, longitude squeezed toward the poles"""
    best_ = np.full(lon_h.shape, 1e9)
    for (ax, ay), (bx, by) in zip(pts[:-1], pts[1:]):
        dxa = ((lon_h - ax + 180) % 360 - 180) * coslat
        dya = lat_h - ay
        ex, ey = (bx - ax) * math.cos(math.radians((ay + by) / 2)), by - ay
        t = np.clip((dxa * ex + dya * ey) / (ex * ex + ey * ey + 1e-9), 0, 1)
        d = np.hypot(dxa - t * ex, dya - t * ey)
        best_ = np.minimum(best_, d)
    return best_


hills = fbm(w2, h2, 24, 5, 3)
crags = fbm(w2, h2, 64, 3, 9)
inland = smooth(-0.2, 2.5, sd_h)
height = inland * (0.16 + 0.12 * hills)
for pts, peak, width in MOUNTAINS:
    d = ridge_distance(pts)
    lumps = 0.55 + 0.75 * crags
    height = height + inland * peak * np.exp(-(d / width) ** 2) * lumps
height = np.clip(height, 0, 1)
print('heights done')

# ---- Lights ----

lights = np.zeros_like(lon_h)
for x, y, wgt, spread in PEOPLE:
    dx = ((lon_h - x + 180) % 360 - 180) * coslat
    d2 = dx * dx + (lat_h - y) ** 2
    lights += wgt * np.exp(-d2 / (spread * spread))
speckle = fbm(w2, h2, 128, 3, 41)
lights = np.clip(lights * (0.5 + speckle) * smooth(0.1, 0.8, sd_h), 0, 1) ** 0.8

# ---- Biomes ----


def blobs(items):
    m = np.zeros_like(lon_h)
    for x, y, rx, ry in items:
        dx = ((lon_h - x + 180) % 360 - 180) / rx
        m = np.maximum(m, np.exp(-(dx * dx + ((lat_h - y) / ry) ** 2) ** 1.4))
    return m


wobble = fbm(w2, h2, 16, 4, 77)
desert = np.clip(blobs(DESERTS) * (0.7 + 0.6 * wobble), 0, 1)
jungle = np.clip(blobs(JUNGLES) * (0.7 + 0.6 * wobble), 0, 1)
# December: snow over the north. Lower inland, held back on the west coasts the sea keeps warm.
west_warm = np.exp(-(((lon_h - 0) / 25) ** 2)) * np.exp(-(((lat_h - 55) / 12) ** 2)) * 7 + np.exp(
    -(((lon_h + 125) / 8) ** 2)) * np.exp(-(((lat_h - 50) / 8) ** 2)) * 5
snowline = 46 + west_warm + 4 * (wobble - 0.5) - np.clip(sd_h, 0, 12) * 0.25
snow = smooth(-2.5, 2.5, lat_h - snowline)
snow = np.maximum(snow, smooth(0.45, 0.7, height))  # snowcaps
icecap = smooth(-58, -62, lat_h)
ice = np.clip(icecap + smooth(0.0, 1.0, (lat_h > 58) * (lon_h > -75) * (lon_h < -10) * (lat_h - 59)), 0, 1)
snow = np.maximum(snow, ice)
# Tropics and the southern summer are green; the subtropics dry out
south_summer = smooth(-15, -35, lat_h) * (1 - snow)
savanna = smooth(8, 16, np.abs(lat_h)) * smooth(30, 22, np.abs(lat_h)) * (1 - jungle)


def rgb(h):
    h = h.lstrip('#')
    return np.array([int(h[i:i + 2], 16) / 255 for i in (0, 2, 4)])


def lay(base, colour, amount):
    a = np.clip(amount, 0, 1)[..., None]
    return base * (1 - a) + rgb(colour) * a


grain = fbm(w2, h2, 96, 3, 5)[..., None]
col = np.ones((h2, w2, 3)) * rgb('#8DBF5A')
col = lay(col, '#6FAE4E', smooth(0.3, 0.8, wobble))
col = lay(col, '#C7C46A', savanna)
col = lay(col, '#E7C27F', desert)
col = lay(col, '#D9A863', desert * smooth(0.5, 0.9, hills))
col = lay(col, '#3F9A55', jungle)
col = lay(col, '#2F8048', jungle * smooth(0.4, 0.8, wobble))
col = lay(col, '#7FCB62', south_summer * 0.6)
col = lay(col, '#A99A8A', smooth(0.25, 0.55, height) * (1 - snow))
col = lay(col, '#F4F8FF', snow)
col = lay(col, '#DCE8F7', snow * smooth(0.45, 0.85, wobble) * 0.6)
col = lay(col, '#E6F1FF', ice)
col = col * (0.92 + 0.16 * grain)

life = np.zeros((h2, w2, 3))
land_h = smooth(0.2, 0.6, sd_h)
boreal = smooth(42, 48, lat_h) * smooth(70, 64, lat_h) + smooth(-38, -44, lat_h) * smooth(-56, -50, lat_h) * 0.8
life[..., 0] = land_h * boreal * (1 - desert) * (1 - smooth(0.4, 0.6, height)) * (1 - ice)
life[..., 0] *= 0.35 + 0.65 * smooth(0.35, 0.65, wobble)
temperate = smooth(18, 28, np.abs(lat_h)) * smooth(52, 44, np.abs(lat_h))
life[..., 1] = land_h * np.clip(temperate * (1 - snow * 0.6) + jungle * 0.5 + south_summer * 0.4, 0, 1)
life[..., 1] *= (1 - desert) * (1 - smooth(0.35, 0.6, height)) * (0.4 + 0.6 * smooth(0.3, 0.7, wobble))
coast = smooth(5, 0.5, sd_h)
life[..., 2] = land_h * smooth(27, 18, np.abs(lat_h)) * np.clip(jungle + coast, 0, 1) * (1 - desert)
life = np.clip(life, 0, 1)

# ---- Spread the paint past the coast, then save ----

col_full = np.stack([upsample(col[..., c], W, H) for c in range(3)], -1)
nearest = col_full[np.clip(sy, 0, H - 1), np.clip(sx, 0, W - 1)]
col_full = np.where(land[..., None], col_full, nearest)

shape = np.stack([
    np.clip(0.5 + sd / 16, 0, 1),
    upsample(height, W, H),
    upsample(lights, W, H),
], -1)


def save(name, a):
    h, w = a.shape[:2]
    img = bpy.data.images.new(name, w, h, alpha=False)
    img.colorspace_settings.name = 'Non-Color'
    rgba = np.ones((h, w, 4), np.float32)
    rgba[..., :3] = np.clip(a, 0, 1)
    img.pixels.foreach_set(rgba[::-1].ravel())
    img.filepath_raw = os.path.join(OUT, name)
    img.file_format = 'PNG'
    img.save()
    print('saved', name, w, h)


save('world_shape.png', shape)
save('world_color.png', col_full)
save('world_life.png', np.stack([upsample(life[..., c], 512, 256) for c in range(3)], -1))
