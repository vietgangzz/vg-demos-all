# Rank Up: art

The demo is bright and fresh, and each league is a world of its own colour. Silver's world is aqua.
Gold's world is a pink-to-amber sunrise that floods the screen when you're promoted.

There are two scenes:

- **The board:** Silver's leaderboard in the last seconds of the week. The rest of the board draws back and you
  climb from fifth to first.
- **The promotion:** the Silver badge charges up, spins, and bursts into the Gold badge.

The app draws all text, numbers, backgrounds, light and confetti. The images are objects only.

The PNGs here are placeholders. Generate each image below and overwrite the file at the same path. No code
changes are needed.

## Instructions for Codex

> Generate every image in `assets/rank-up/art/PROMPTS.md` with the image tool. Prepend the style block for its
> group (**Badge style** or **Avatar style**) to each prompt. Every image is **1:1, 1024×1024, with a
> TRANSPARENT background**. If transparency isn't possible, generate on flat pure `#00FF00` and key the green
> out (nothing in these images is green). Save each result as a PNG at exactly the path given, replacing the
> placeholder.
>
> Order:
> 1. Generate `league-gold.png` first.
> 2. Attach it as the reference for `league-silver.png`. The two must share **the exact same silhouette,
>    size and camera**: the badge spins and swaps from one face to the other, so any difference in outline
>    will show.
> 3. Generate `avatar-you.png` next.
> 4. Attach it as the style reference for the other seven avatars so the set matches.
>
> Afterwards, post-process each file:
> - Badges: trim to content and pad to 512×512:
>   `magick in.png -trim +repage -resize 470x470 -gravity center -background none -extent 512x512 out.png`
> - Avatars: resize to 256×256: `magick in.png -resize 256x256 out.png`

### Badge style

```
Premium 3D mobile game league emblem, glossy and joyful: polished metal with crisp bevels and bright specular
highlights, deep glossy enamel, small cut gems that sparkle, a warm rim light. Clean, saturated and cheerful,
never dark or muddy, and it must read well on both an aqua and a hot pink-orange background. One single object, perfectly symmetrical, centred, facing straight at the camera
(orthographic front view, no tilt), filling about 85% of the frame. Transparent background, no cast shadow,
no floor, no glow halo outside the object. Original design, not based on any existing game or brand. No text,
no letters, no numbers, no logo, no watermark.
```

### Avatar style

```
Round profile avatar of an original character: a refined stylised 3D render, soft natural proportions,
friendly eyes, a warm smile and bright studio lighting, like a premium mobile game's player portrait.
Fresh, cheerful colours.
Head and shoulders, centred, looking at the camera, cropped inside a perfect circle that fills the whole
image. The circle's backdrop is a soft single-colour gradient in the colour given below. Everything outside
the circle is transparent. No text, no letters, no logo, no watermark, no border ring.
```

---

## 01 · `league-gold.png`: the Gold League badge (the hero)
Seen big in the middle of the screen as the promotion's payoff, in a burst of light.

```
A slim heraldic shield badge in polished champagne gold with a fine raised rim, its face a deep midnight navy
enamel. In the middle sits a big faceted gold five-pointed star with a round ruby set in its centre. A small
gold crown with three pearl-tipped points sits on top of the shield, and two swept gold wings spread from its
upper sides, their feathers finely engraved. Tiny diamonds are set along the rim. Precious, calm and
celebratory.
```

## 02 · `league-silver.png`: the Silver League badge (the "before")
It sits over the leaderboard, then charges, spins and becomes the gold one.

```
The same badge as the reference image, with exactly the same shield shape, crown, wings, proportions and
camera, remade in polished cool platinum-silver instead of gold. Its face is a slate grey-blue enamel. In the
middle, instead of the star, are two thick bevelled silver chevrons pointing upward. Small clear crystals
are set along the rim instead of sapphires. Cleaner and plainer than the gold one, but still premium.
```

## 03 to 10 · the players on the board
A character is described for each. Keep each one distinct and friendly.

| File | Character | Backdrop colour |
|---|---|---|
| `avatar-you.png` | a cheerful young person with short messy hair and a yellow hoodie, a confident grin | sunny yellow |
| `avatar-mina.png` | a young woman with a high black ponytail and a pink bomber jacket, a sly smile | bubblegum pink |
| `avatar-kenji.png` | a young man with round glasses and a blue beanie, a calm smile | sky blue |
| `avatar-lucia.png` | a young woman with big curly brown hair and gold hoop earrings, laughing | tangerine |
| `avatar-theo.png` | a freckled young man with ginger hair and a green cap, a friendly smile | fresh green |
| `avatar-ama.png` | a young woman with short natural hair and a purple scarf, a warm smile | lavender |
| `avatar-rafael.png` | a young man with a short beard and a teal headband, a big grin | aqua |
| `avatar-priya.png` | a young woman with a long braid and a coral sweater, a soft smile | coral |

The prompt for each avatar is the **Avatar style** block followed by:

```
The character: <character from the table>. Backdrop: <backdrop colour from the table>.
```

---

## Round 2 · reactions (Duolingo-style personality)

The promotion now ends with **you** catching the Gold badge and cheering, and the four players you overtake
pull a shocked face as your row knocks them down. Save these next to the others in `assets/rank-up/art/`.

> **Instructions for Codex:** attach `avatar-you.png` as the character reference for 11 to 13, and the matching
> `avatar-<name>.png` as the reference for 14 to 17, so each is unmistakably the same character in the same
> render style. Post-process 11 to 13 with
> `magick in.png -trim +repage -resize 680x680 -gravity south -background none -extent 768x768 out.png`
> (feet on the bottom edge), and 14 to 17 with `magick in.png -resize 256x256 out.png`.

### Full-body style (11 to 13)

```
Full-body original 3D cartoon character, the same character as the reference image (same face, hair, yellow
hoodie, colours and render style): a refined stylised 3D render with soft natural proportions, big
expressive eyes, bright studio lighting, like a premium mobile game mascot moment. Seen from the front,
centred, the whole body in frame with the feet at the bottom. Transparent background, no floor, no cast
shadow, no props unless described. No text, no letters, no logo, no watermark.
```

| File | Pose |
|---|---|
| `you-ready.png` | standing, knees slightly bent, looking up eagerly, both hands raised a little in front of the chest as if about to catch something, mouth open in excitement |
| `you-catch.png` | jumping in the air, both arms stretched straight up with open palms facing up and slightly apart (empty hands: the app places the badge between them), legs tucked, a huge open-mouthed grin |
| `you-cheer.png` | landed, one fist pumped high, the other hand making a fist at the hip, eyes squeezed shut with joy, big laughing mouth |

### Shocked faces (14 to 17)

Same as **Avatar style** above, followed by:

```
The same character as the reference image, with exactly the same framing, circle, backdrop colour, hair and
clothes, but now comically shocked: eyes wide, eyebrows high, mouth a round "O", one hand on the cheek.
```

| File | Reference |
|---|---|
| `avatar-mina-shock.png` | `avatar-mina.png` |
| `avatar-kenji-shock.png` | `avatar-kenji.png` |
| `avatar-lucia-shock.png` | `avatar-lucia.png` |
| `avatar-theo-shock.png` | `avatar-theo.png` |
