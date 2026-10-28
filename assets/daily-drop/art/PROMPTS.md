# Daily Drop: painted art

The demo works with the placeholder PNGs in this folder. Generate each image below, overwrite the
file at the same path, and reload the app. The 3D chest, coins, gems and pedestal are modelled in
Blender (scripts/blender/daily_drop_models.py) and the card frames, numbers and labels are drawn by
the app, so **none of these images may contain text, numbers, frames or UI**.

## Instructions for Codex

> Generate each image in `assets/daily-drop/art/PROMPTS.md` with the image tool. Prepend the
> **Shared style** block to every prompt. Save each result as PNG at exactly the path given,
> replacing the placeholder.
>
> If the tool can't produce the requested aspect ratio, generate the closest taller image and crop
> to the exact ratio, keeping the centre (see Post-processing).
>
> Don't add text, letters, numbers, logos, signatures, watermarks, card frames or borders to any
> image.

### Shared style

```
Premium fantasy mobile game art, painterly with a polished 3D-rendered finish, highly detailed,
rich saturated jewel tones: deep violet, midnight blue, sapphire and molten gold. Soft volumetric
light, crisp silhouettes, glowing rim light, tiny floating sparkles. Original design, not based on
any existing game or character. No text, no letters, no numbers, no logo, no watermark, no frame,
no border, no user interface.
```

---

## 01 · `backdrop.png`: the vault behind the chest
**1:2 portrait (1024×2048). Opaque.** Shown full screen behind the 3D chest. The chest stands at
about **55% down from the top, in the centre**, so that area must be an empty, softly lit floor.
The top 18% sits behind the wallet and the title, and the bottom 25% behind the cards and the
button, so keep both dark and calm.

```
Inside an ancient treasure vault at night, seen straight on at eye level, perfectly symmetric
composition. A tall arched stone chamber of dark violet-blue stone with thin gold inlay lines
tracing the arches, two rows of tall columns receding into darkness on both sides, heaps of gold
coins and jewels glinting faintly in the far shadows at the left and right edges. A single soft
shaft of warm golden light falls from a round opening high above onto an empty circular stone
floor in the centre of the image, about 55% down from the top, the pool of light empty and
waiting. Dust and tiny gold sparkles float in the light shaft. The top fifth of the image is deep
shadow under the vault ceiling; the bottom quarter is a dark, softly reflective stone floor fading
to near black. Cinematic, mysterious, inviting.
```

## 02 · `card-coins.png`: the common reward
**2:3 portrait (1024×1536). Opaque, full bleed.** The card art. The app puts a name plate over the
**bottom 28%**, so the subject sits in the **upper 70%**.

```
A plump burlap sack tied with a frayed rope, tipped over and overflowing with shiny gold coins
that spill and bounce toward the viewer, a few coins in mid-air catching the light, on a dark
warm wooden table. Background: a soft dark teal-blue gradient with gentle bokeh. Warm key light
from the upper left, golden glints on every coin edge. The subject fills the upper 70% of the
image; the bottom 28% is a calm, darker continuation of the table.
```

## 03 · `card-gems.png`: the epic reward
**2:3 portrait (1024×1536). Opaque, full bleed.** Same framing as 02.

```
A small deep-purple velvet pouch with gold embroidery and a golden drawstring, open at the top,
with a cascade of large faceted gemstones bursting out of it: violet amethysts, cyan diamonds and
a few magenta rubies, each gem glowing from inside and throwing coloured caustic light. Background:
a rich violet-to-indigo gradient with soft arcane swirls of light and tiny stars. Dramatic rim light
in cyan and magenta. The subject fills the upper 70% of the image; the bottom 28% is a calm,
darker continuation of the background.
```

## 04 · `card-fox.png`: the legendary reward
**2:3 portrait (1024×1536). Opaque, full bleed.** Same framing as 02. This one gets a holographic
foil in the app, so it should be the most spectacular.

```
A majestic legendary spirit fox companion, the Ember Fox: a sleek fox with fur that turns into
living flame at the tips of its ears, its three tails and its mane, glowing amber eyes, a small
golden circlet with a ruby on its brow. It leaps toward the viewer in a dynamic three-quarter pose,
embers and swirling fire trailing behind it. Background: a blazing sunset sky of molten gold,
orange and crimson with radiant god rays behind the fox. Epic, heroic, warm, vibrant. The fox fills
the upper 70% of the image; the bottom 28% is a calmer, darker band of glowing embers.
```

## 05 · `card-back.png`: the back of every card
**2:3 portrait (1024×1536). Opaque, full bleed.** Seen before each card is flipped. Mirror
symmetric, top to bottom and left to right.

```
The ornate back of a collectible fantasy game card: a deep midnight-indigo lacquered surface with
an intricate engraved filigree pattern in gold leaf, perfectly symmetric in both directions, a
radiant eight-pointed star medallion in the exact centre with a glowing violet gem at its heart,
fine gold scrollwork in the corners, a subtle diamond lattice texture across the background. Rich,
precious, mysterious. Fills the entire image edge to edge with no border.
```

---

## Post-processing

Crop to the exact ratio, keeping the centre:

```bash
magick in.png -gravity center -crop 1:2 +repage out.png   # 01
magick in.png -gravity center -crop 2:3 +repage out.png   # 02 to 05
```

Keep the long side at 2048 px or less:

```bash
magick out.png -resize "2048x2048>" out.png
```
