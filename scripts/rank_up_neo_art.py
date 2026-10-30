"""
Installs Rank Up Neo's Codex art (assets/rank-up-neo/art/generated and generated-v2, made from the
prompts in assets/rank-up-neo/art/tron-prompts.md) into assets/rank-up-neo/art, sized for the app:

- the sky, the skyline, the avatars and the two league badges, as they are or scaled down
- the titles cut into single letters (title/<letter>.png, with title/glyphs.json giving each one's size),
  so they can drop in one at a time; each taken from the line it reads best in
- the buttons cut for stretching: the wide ones into a left end, a sliver of the plain middle and a
  right end (button/<look>-left|mid|right.png); the square quiet one whole (button/quiet.png)

Cuts by the regions Codex wrote alongside them (generated-v2/atlas-regions.json). Needs ImageMagick.
Then render the badges' spin atlases again:

    python3 scripts/rank_up_neo_art.py
    RIM=black ART=assets/rank-up-neo/art /Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/rank_up_spin.py
"""

import json
import os
import shutil
import subprocess

ART = os.path.join(os.path.dirname(__file__), '..', 'assets', 'rank-up-neo', 'art')
V1 = os.path.join(ART, 'generated')
V2 = os.path.join(ART, 'generated-v2')
AVATARS = ['you', 'mina', 'kenji', 'lucia', 'theo', 'ama', 'rafael', 'priya']
# Which line each letter is cut from
LINES = {'GOLD LEAGUE': 'GOLDEAU', 'SILVER LEAGUE': 'SIVR'}
# Room round each letter for its glow
PAD = 10
# The wide buttons' ends, as cut from the art (px); everything between is plain and stretches
END = 200
# How much the buttons are scaled down: 320 px tall in the art, 56 pt in the app at 3x is 168
BUTTON_SCALE = 0.6


def magick(*args):
    subprocess.run(['magick', *args], check=True)


shutil.copy(os.path.join(V1, 'sky.webp'), os.path.join(ART, 'sky.webp'))
shutil.copy(os.path.join(V1, 'horizon.png'), os.path.join(ART, 'horizon.png'))
for name in AVATARS:
    magick(os.path.join(V1, f'avatar-{name}.png'), '-resize', '256x256', os.path.join(ART, f'avatar-{name}.png'))
for league in ('silver', 'gold'):
    magick(os.path.join(V2, f'league-{league}.png'), '-resize', '512x512', os.path.join(ART, f'league-{league}.png'))

regions = json.load(open(os.path.join(V2, 'atlas-regions.json')))

os.makedirs(os.path.join(ART, 'title'), exist_ok=True)
glyphs = {}
for g in regions['titles.png']['glyphs']:
    c = g['character']
    if c in glyphs or c not in LINES[g['row']]:
        continue
    w, h = g['width'] + PAD * 2, g['height'] + PAD * 2
    magick(
        os.path.join(V2, 'titles.png'),
        '-crop', f"{w}x{h}+{g['x'] - PAD}+{g['y'] - PAD}", '+repage',
        os.path.join(ART, 'title', f'{c}.png'),
    )
    glyphs[c] = {'w': w, 'h': h}
json.dump({'pad': PAD, 'cap': regions['titles.png']['glyphs'][0]['height'], 'glyphs': glyphs},
          open(os.path.join(ART, 'title', 'glyphs.json'), 'w'), indent=2, sort_keys=True)

os.makedirs(os.path.join(ART, 'button'), exist_ok=True)
for r in regions['buttons.png']['regions']:
    x, y, w, h = r['x'], r['y'], r['width'], r['height']
    src = os.path.join(V2, 'buttons.png')
    out = lambda part: os.path.join(ART, 'button', f"{r['name']}{part}.png")  # noqa: E731
    size = f'{round(100 * BUTTON_SCALE)}%'
    if w == h:
        magick(src, '-crop', f'{w}x{h}+{x}+{y}', '+repage', '-resize', size, out(''))
        continue
    magick(src, '-crop', f'{END}x{h}+{x}+{y}', '+repage', '-resize', size, out('-left'))
    magick(src, '-crop', f'40x{h}+{x + w // 2 - 20}+{y}', '+repage', '-resize', size, out('-mid'))
    magick(src, '-crop', f'{END}x{h}+{x + w - END}+{y}', '+repage', '-resize', size, out('-right'))
print('ok', sorted(glyphs))
