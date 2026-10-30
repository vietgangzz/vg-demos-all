"""
Rank Up's league badges as solid things, spun round: the promotion's spin (src/demos/rank-up/index.tsx)
plays these frames instead of turning a flat picture, so the badge has a real edge as it goes round
and the light runs over it.

Each badge is the Codex art's own outline (traced with potrace), extruded into a slab with a rounded
metal rim, silver or gold; its faces carry the art, glossy, so the studio light sweeps over them as
it turns. Rendered with Cycles on transparent, the camera framing it exactly as the flat art is
framed, so the app can cross-fade from a frame to the art when it's facing you.

Writes, for each league:
  assets/rank-up/art/spin-<league>.png  an atlas of FRAMES frames, COLS across, CELL px square, one
                                        whole turn about the upright starting face on, turning the
                                        way the app's rotateY does

Needs potrace and ImageMagick on the PATH (Homebrew). Run headless:
  /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/rank_up_spin.py -- [silver|gold]
"""

import json
import math
import os
import shutil
import subprocess
import sys
import tempfile

import bmesh
import bpy
from mathutils import Vector

ARGS = sys.argv[sys.argv.index('--') + 1:] if '--' in sys.argv else []
LEAGUES = ARGS or ['silver', 'gold']
# Whose art: Rank Up's, or another set laid out the same way (ART=assets/rank-up-neo/art)
ART = os.path.abspath(os.environ.get('ART', 'assets/rank-up/art'))
FRAMES = int(os.environ.get('SPIN_FRAMES', 48))
COLS = 8
CELL = 320
# The art is 512 px square; in the scene it's 2 units across, centred
PX = 512
THICK = 0.075
RIM = {
    'silver': (0.86, 0.89, 0.94),
    'gold': (1.0, 0.72, 0.28),
}
# A set whose badges are black glass edged in light wants a black rim, not silver or gold (RIM=black)
if os.environ.get('RIM') == 'black':
    RIM = {league: (0.05, 0.055, 0.06) for league in RIM}
TOOLS = ['/opt/homebrew/bin', '/usr/local/bin']


def tool(name):
    for d in TOOLS:
        if os.path.exists(os.path.join(d, name)):
            return os.path.join(d, name)
    return shutil.which(name) or name


def outline(png, work):
    """The art's outline: rings of points in art pixels, y up, outer rings and holes alike"""
    pbm = os.path.join(work, 'mask.pbm')
    geo = os.path.join(work, 'mask.json')
    subprocess.run([tool('magick'), png, '-alpha', 'extract', '-threshold', '50%', '-negate', pbm], check=True)
    subprocess.run([tool('potrace'), '-b', 'geojson', '-a', '1.0', '-t', '4', '-o', geo, pbm], check=True)
    rings = []
    for f in json.load(open(geo))['features']:
        g = f['geometry']
        polys = g['coordinates'] if g['type'] == 'Polygon' else [r for p in g['coordinates'] for r in p]
        for ring in polys:
            rings.append([(x, y) for x, y in ring[:-1]])
    return rings


def unit(x, y):
    return ((x - PX / 2) / (PX / 2), (y - PX / 2) / (PX / 2))


def reset():
    bpy.ops.wm.read_factory_settings(use_empty=True)
    scene = bpy.context.scene
    scene.render.engine = 'CYCLES'
    prefs = bpy.context.preferences.addons['cycles'].preferences
    try:
        prefs.compute_device_type = 'METAL'
        prefs.get_devices()
        for d in prefs.devices:
            d.use = True
        scene.cycles.device = 'GPU'
    except Exception:
        pass
    scene.cycles.samples = 96
    scene.cycles.use_denoising = True
    scene.render.film_transparent = True
    scene.render.resolution_x = CELL
    scene.render.resolution_y = CELL
    scene.render.image_settings.file_format = 'PNG'
    scene.render.image_settings.color_mode = 'RGBA'
    # Standard, so the art's colours come out as they went in
    scene.view_settings.view_transform = 'Standard'
    world = bpy.data.worlds.new('world')
    scene.world = world
    world.use_nodes = True
    nt = world.node_tree
    env = nt.nodes.new('ShaderNodeTexEnvironment')
    lights = os.path.join(os.path.dirname(bpy.app.binary_path), '..', 'Resources')
    for v in sorted(os.listdir(lights)):
        path = os.path.join(lights, v, 'datafiles', 'studiolights', 'world', 'studio.exr')
        if os.path.exists(path):
            env.image = bpy.data.images.load(path)
    bg = nt.nodes['Background']
    bg.inputs['Strength'].default_value = 0.9
    nt.links.new(env.outputs['Color'], bg.inputs['Color'])
    # A warm key high on the left, a cool rim from behind on the right, and a big soft box over the
    # camera's shoulder for the faces to mirror as they come round
    for name, loc, energy, colour, size in (
        ('key', (-4, 5, 4), 700, (1.0, 0.93, 0.82), 3),
        ('rim', (5, 2, -3), 900, (0.8, 0.88, 1.0), 2),
        ('box', (2.5, 3, 7), 500, (1.0, 0.97, 0.92), 6),
    ):
        data = bpy.data.lights.new(name, 'AREA')
        data.energy = energy
        data.color = colour
        data.size = size
        o = bpy.data.objects.new(name, data)
        o.location = loc
        o.rotation_euler = (Vector((0, 0, 0)) - Vector(loc)).to_track_quat('-Z', 'Y').to_euler()
        scene.collection.objects.link(o)
    # Looking down -z with y up, far off and long so it hardly distorts; the art's square, 2 units,
    # fills the frame exactly at the badge's middle
    cam = bpy.data.cameras.new('cam')
    cam.lens = 85
    cam.sensor_fit = 'HORIZONTAL'
    cam.sensor_width = 36
    o = bpy.data.objects.new('cam', cam)
    o.location = (0, 0, 2 * cam.lens / cam.sensor_width)
    scene.collection.objects.link(o)
    scene.camera = o
    return scene


def face_material(png):
    m = bpy.data.materials.new('face')
    m.use_nodes = True
    nt = m.node_tree
    b = nt.nodes['Principled BSDF']
    tex = nt.nodes.new('ShaderNodeTexImage')
    tex.image = bpy.data.images.load(png)
    tex.interpolation = 'Cubic'
    nt.links.new(tex.outputs['Color'], b.inputs['Base Color'])
    nt.links.new(tex.outputs['Color'], b.inputs['Emission Color'])
    b.inputs['Emission Strength'].default_value = 0.3
    b.inputs['Roughness'].default_value = 0.3
    # A clear coat over the art, for the light to run across as it turns
    b.inputs['Coat Weight'].default_value = 0.6
    b.inputs['Coat Roughness'].default_value = 0.06
    return m


def rim_material(colour):
    m = bpy.data.materials.new('rim')
    m.use_nodes = True
    b = m.node_tree.nodes['Principled BSDF']
    b.inputs['Base Color'].default_value = (*colour, 1)
    b.inputs['Metallic'].default_value = 1.0
    b.inputs['Roughness'].default_value = 0.2
    return m


def badge(league, work):
    png = os.path.join(ART, f'league-{league}.png')
    curve = bpy.data.curves.new('outline', 'CURVE')
    curve.dimensions = '2D'
    curve.fill_mode = 'BOTH'
    curve.extrude = THICK - 0.025
    curve.bevel_depth = 0.025
    curve.bevel_resolution = 4
    for ring in outline(png, work):
        s = curve.splines.new('POLY')
        s.points.add(len(ring) - 1)
        for p, (x, y) in zip(s.points, ring):
            p.co = (*unit(x, y), 0, 1)
        s.use_cyclic_u = True
    obj = bpy.data.objects.new('badge', curve)
    bpy.context.scene.collection.objects.link(obj)
    bpy.context.view_layer.objects.active = obj
    obj.select_set(True)
    bpy.ops.object.convert(target='MESH')
    obj = bpy.context.view_layer.objects.active
    mesh = obj.data
    mesh.materials.append(face_material(png))
    mesh.materials.append(rim_material(RIM[league]))
    # The flat faces, front and back, carry the art, mapped as it lies in the picture; the rest is rim
    bm = bmesh.new()
    bm.from_mesh(mesh)
    bm.normal_update()
    # Our own mapping, in place of any the curve came with
    for layer in list(bm.loops.layers.uv.values()):
        bm.loops.layers.uv.remove(layer)
    uv = bm.loops.layers.uv.new('UVMap')
    for f in bm.faces:
        flat = abs(f.normal.z) > 0.97
        f.material_index = 0 if flat else 1
        f.smooth = not flat
        for loop in f.loops:
            x, y = loop.vert.co.x, loop.vert.co.y
            loop[uv].uv = ((x + 1) / 2, (y + 1) / 2)
    bm.to_mesh(mesh)
    bm.free()
    return obj


def render(league):
    scene = reset()
    work = tempfile.mkdtemp()
    obj = badge(league, work)
    frames = []
    for i in range(FRAMES):
        # The app turns it with rotateY: positive is the right edge going away from you, which is a
        # turn about +y the other way round in Blender's right-handed frame
        obj.rotation_euler = (0, -2 * math.pi * i / FRAMES, 0)
        path = os.path.join(work, f'f{i:03d}.png')
        scene.render.filepath = path
        bpy.ops.render.render(write_still=True)
        frames.append(path)
    out = os.path.join(ART, f'spin-{league}.png')
    subprocess.run(
        [tool('magick'), 'montage', *frames, '-background', 'none', '-tile', f'{COLS}x', '-geometry', f'{CELL}x{CELL}+0+0', out],
        check=True,
    )
    print('wrote', out)


for league in LEAGUES:
    render(league)
