# Water Puppets: painted art

The demo works with the placeholder PNGs in this folder. Generate each image below, overwrite the file at the same path, and reload the app. The code reads any size. The **aspect ratio** and the **composition notes** matter, because each image is laid at a fixed place in the 3D scene.

## Instructions for Codex

> Generate each image in `assets/water-dragon/art/PROMPTS.md` with the image tool. Prepend the **Shared style** block to every scene prompt (01–08, 11), or the **Texture style** block to the texture prompts (04–06, 09). Save each result as PNG at exactly the path given, replacing the placeholder.
>
> When an image is marked TRANSPARENT:
> - Request a transparent background.
> - If the tool can't produce transparency, generate it on a flat pure `#00FF00` green background and key the green out (see Post-processing).
>
> If the tool can't produce the requested aspect ratio, generate the widest image it can and crop to the exact ratio (see Post-processing), keeping the side named in the notes.
>
> Don't add text, letters, signatures, watermarks or frames to any image.

### Shared style (scene images)

```
Cinematic painterly matte painting, highly detailed, the northern Vietnamese countryside on a still
night under a full moon. Cool moonlit palette of deep indigo, blue-violet and silver, with small warm
accents of lantern orange and candle gold. Soft atmospheric depth and gentle mist, crisp silhouettes,
subtle film grain. Authentic Vietnamese architecture and plants only. No modern objects: no power
lines, cars, concrete, plastic or electric lights. No text, letters, logos or watermark.
```

### Texture style (flat material maps)

```
Flat material texture map photographed straight on (orthographic, no perspective), even soft diffuse
light, no cast shadows, no vignette, no highlights burned in, high detail, no text or watermark.
```

---

## 01 · `sky.png`: the night sky
**3:1 (3072×1024). Opaque.** Hung far behind everything. The code draws the moon itself and turns the sky so the moonlit clouds, painted about a third of the way in from the left, sit round it. Don't paint a moon disc.

```
A wide panoramic night sky only, no land, no trees, no moon disc. Deep indigo at the top shading to a
dusky violet-mauve haze along the bottom edge. Long, soft, layered strato clouds drifting
horizontally across the lower half, their edges lit silver from a bright moon just out of frame low
on the left (around 34% from the left, about 25% up from the bottom). A faint Milky Way band rising diagonally on
the right. Sparse, tiny, sharp stars in the clear upper sky. Calm, vast, cinematic.
```

## 02 · `hills.png`: distant mountains
**3:1 (3072×1024). TRANSPARENT.** Mirrored side to side. The **right edge** sits directly behind the stage, and the left third is mostly off-screen.

```
Distant mountain range of northern Vietnam, soft limestone karst peaks and long low ridges, very far
away, flat blue-grey silhouettes heavily veiled in atmospheric haze, the tops faintly rim-lit silver
by moonlight from the right. The mountains occupy ONLY the bottom 30% of the image and the whole top
70% is completely transparent. The bottom edge is solid and fully opaque across the entire width,
dissolving upward into pale mist. The rightmost 15% of the image is lower, gentler ridges; the
tallest peaks sit between 40% and 80% from the left.
```

## 03 · `village.png`: the far bank
**3:1 (3072×1024). TRANSPARENT.** Mirrored side to side. The **right edge** sits directly behind the stage house. The landmarks show between 45% and 85% from the left.

```
The far bank of a Vietnamese village pond at night, seen across the water: dense clumps of bamboo
(tre) with tall feathery arching tops, slender areca palms (cau), one great old banyan tree (cây đa)
with a wide crown and hanging aerial roots, the sweeping tiled roof of a village communal house (đình)
with up-curled corners half hidden in the trees, a small three-tier pagoda tower, two or three low
tile-roofed houses with tiny warm-lit doorways. Everything nearly silhouetted in dark blue-black,
top edges of leaves and roofs rim-lit by cool moonlight from the right, thin mist lying along the
bank. The scene occupies ONLY the bottom 50% of the image; the top 50% is completely transparent. The
bottom edge is a solid, fully opaque dark bank across the entire width, with no water painted in front
of it. The banyan, the communal
house roof and the pagoda are between 45% and 85% from the left; the rightmost 15% is a low, simple
line of bamboo (it is hidden behind a building).
```

## 04 · `roof-tiles.png`: roof tiles
**1:1 (1024×1024). Opaque. Seamless tiling in both directions.**

```
Seamless tileable texture of traditional northern Vietnamese clay roof tiles "ngói mũi hài": small
flat terracotta tiles with rounded, slipper-toe ends, overlapping in staggered horizontal rows, about
9 rows and 10 tiles per row in the square. Aged weathered red-brown terracotta with darker soot
streaks, patches of dark green moss and pale lichen, slight colour variation tile to tile. Rows run
exactly horizontal, the rounded ends pointing down.
```

## 05 · `bamboo-blind.png`: the bamboo screen (mành tre)
**1:1 (1024×1024). Opaque. Seamless tiling in both directions.** The dark gaps between slats glow with light from behind, so they must be **near black**.

```
Seamless tileable texture of a traditional Vietnamese split-bamboo blind (mành tre): about 40 thin
vertical slats of split bamboo across the square, golden-tan to honey-brown, with visible bamboo
nodes at irregular heights, fine fibres and slight wear. Between every slat a narrow, near-black gap.
Woven through horizontally every quarter of the height, a thin twisted cord of faded red-brown.
```

## 06 · `frieze.png`: the carved frieze under the eaves
**4:1 (2048×512). Opaque. Seamless left to right.** Gold is picked out by the code to make it shine, so keep the gilding a clear yellow-gold and the ground a lacquer red.

```
A long horizontal carved wooden frieze panel from a Vietnamese communal house (đình), seen straight
on: a deep red lacquer ground (sơn son) with raised gilded relief (thếp vàng) carving of swirling
clouds, lotus flowers and leaves, and stylised dragon-scroll motifs, in a continuous repeating
band. A narrow plain gilded border along the top and bottom edges. Rich, old, slightly worn gilding.
Seamless left to right.
```

## 07 · `ridge-dragons.png`: lưỡng long chầu nguyệt
**4:1 (2048×512). TRANSPARENT.** Sits on the top ridge of the stage house, so **the dragons rest on the bottom edge** of the image.

```
Roof-ridge ornament of a Vietnamese temple, "two dragons paying homage to the moon" (lưỡng long chầu
nguyệt), seen exactly side-on: two long sinuous dragons in glazed ceramic mosaic and gilding, gold
and jade green with red accents, mirror-symmetric, their undulating bodies resting along the bottom
edge of the image, heads raised facing each other toward the centre, where a round flaming pearl /
moon disc with a ring of flame tongues stands on the ridge. Curling cloud-tails at the far left and
right ends. Fills the full width; the tallest point (the flames and heads) reaches about 85% of the
height. Transparent background.
```

## 08 · `musicians.png`: the band beside the stage
**3:2 (1536×1024). TRANSPARENT.** Stands on a small platform stage left, lit by its own lantern.

```
The traditional water-puppet orchestra, five musicians seated cross-legged side by side on a reed
mat, facing the viewer, eye level, full figures: a man at a large barrel drum (trống cái), a man with
a small drum and wooden clapper, a woman playing the đàn bầu monochord, a man playing a bamboo flute
(sáo), a woman with a two-string fiddle (đàn nhị). Traditional dress: men in dark áo the and khăn xếp
turbans, women in áo tứ thân with khăn mỏ quạ headscarves. Lit warmly from a lantern above and in
front, deep shadows behind, night. The mat touches the bottom edge of the image; transparent background
above and around them.
```

## 09 · `lotus-leaf.png`: a floating lotus leaf
**1:1 (1024×1024). TRANSPARENT.** Laid flat on the water and seen from above.

```
A single lotus leaf (lá sen) floating flat on water, seen exactly from directly above (top-down
orthographic), nearly circular with one small notch from the edge to the centre, rich dark green with
a waxy matte bloom, radial veins from the centre, edges slightly curled up and darker, a few beads of
water sitting on it. Centred, filling about 95% of the square. Transparent background, no water.
```

## 10 · `reeds.png`: reeds and lotus at the pond's edge
**2:3 (1024×1536). TRANSPARENT.** Stands up out of the water at the pond's corners, near the camera.

```
A clump of pond plants growing up out of the water: tall slender rush and reed blades, some bent,
two lotus stalks with closed pink buds, one half-open pink lotus flower, one large lotus leaf held up
on its stalk and tilted. Night: mostly dark green near-silhouettes, cool silver moon rim light from the
upper right, a faint warm glow on the flower. The stems all rise from the bottom edge, the clump's
base centred at the bottom; plenty of transparent space at the top and sides.
```

## 11 · `poster.png`: the title card (shown while the show loads)
**2:1 (2048×1024). Opaque.** The title is laid over the **left 40%**, so keep that side dark and quiet.

```
Key art in the style of a Vietnamese lacquer painting (tranh sơn mài): a deep black-and-cinnabar
lacquer ground with gold leaf, silver leaf and crushed eggshell inlay. A gilded water-puppet dragon
rearing out of stylised curling waves, facing a green-and-gold cobra puppet with its hood spread,
spray of water between them in silver leaf; behind them a water pavilion (thủy đình) with up-curled
roof corners and a row of red lanterns, a huge pale moon in eggshell, lotus flowers on the water.
Composition: the action fills the RIGHT 60% of the image; the LEFT 40% is calm dark lacquer with only
faint gold wave patterns, for a title to be placed there. No text, letters or seals.
```

---

## Post-processing

Key out a green background (for TRANSPARENT images the tool couldn't make transparent):

```bash
magick in.png -fuzz 22% -transparent "#00FF00" -channel A -morphology Erode Disk:1 +channel out.png
```

Crop to the exact ratio, keeping the bottom (02, 03, 10) or the centre (everything else):

```bash
magick in.png -gravity south -crop 3:1 +repage out.png
```

Keep the long side at 3072 px or less (they're decoded to memory on the phone):

```bash
magick out.png -resize "3072x3072>" out.png
```
