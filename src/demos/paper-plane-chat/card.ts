import { PixelRatio } from 'react-native';
import { BlendMode, Skia, TileMode } from 'react-native-skia';
import * as THREE from 'three/webgpu';

import { PAGE_H } from '../paper-plane/paper';

/**
 * A message as a card of good paper, the size of a sheet you'd fold a plane from: ivory stock,
 * a deckle of grain, faint ruled lines, the message set at the top, the sender and time below.
 */

const SCALE = Math.min(3, PixelRatio.get());

export function cardTexture(text: string, from: string, time: string, widthPt: number, into?: THREE.DataTexture) {
  const w = Math.round(widthPt * SCALE);
  const h = Math.round(widthPt * PAGE_H * SCALE);
  const surface = Skia.Surface.Make(w, h);
  const pixels = new Uint8Array(w * h * 4);
  if (surface) {
    const canvas = surface.getCanvas();
    canvas.scale(SCALE, SCALE);
    const W = widthPt;
    const H = widthPt * PAGE_H;
    const base = Skia.Paint();
    base.setColor(Skia.Color('#F7F3EA'));
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), base);
    const grain = Skia.Paint();
    grain.setShader(Skia.Shader.MakeFractalNoise(1.4, 1.4, 3, 11, 0, 0));
    grain.setBlendMode(BlendMode.Multiply);
    grain.setAlphaf(0.05);
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), grain);
    const edge = Skia.Paint();
    edge.setShader(
      Skia.Shader.MakeRadialGradient(
        { x: W / 2, y: H / 2 },
        H * 0.7,
        [Skia.Color('rgba(200,180,150,0)'), Skia.Color('rgba(190,165,130,0.16)')],
        [0.6, 1],
        TileMode.Clamp
      )
    );
    canvas.drawRect(Skia.XYWHRect(0, 0, W, H), edge);
    // Faint rules from a third of the way down, where you'd keep writing
    const rule = Skia.Paint();
    rule.setColor(Skia.Color('rgba(120,140,190,0.16)'));
    rule.setStrokeWidth(0.6);
    for (let y = H * 0.36; y < H - 14; y += 15) canvas.drawLine(14, y, W - 14, y, rule);

    const pad = 16;
    const body = Skia.ParagraphBuilder.Make()
      .pushStyle({ color: Skia.Color('#1C1D22'), fontSize: 16, fontStyle: { weight: 500 }, letterSpacing: -0.1 })
      .addText(text)
      .build();
    body.layout(W - pad * 2);
    body.paint(canvas, pad, pad + 18);
    const head = Skia.ParagraphBuilder.Make()
      .pushStyle({
        color: Skia.Color('rgba(28,29,34,0.45)'),
        fontSize: 10.5,
        fontStyle: { weight: 600 },
        letterSpacing: 0.8,
      })
      .addText(from.toUpperCase())
      .build();
    head.layout(W);
    head.paint(canvas, pad, pad - 2);
    const foot = Skia.ParagraphBuilder.Make()
      .pushStyle({ color: Skia.Color('rgba(28,29,34,0.4)'), fontSize: 10.5, fontStyle: { weight: 500 } })
      .addText(time)
      .build();
    foot.layout(W);
    foot.paint(canvas, W - pad - foot.getMaxIntrinsicWidth(), H - pad - foot.getHeight());
    surface.flush();
    const read = surface.makeImageSnapshot().readPixels();
    if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  }
  const flipped = new Uint8Array(pixels.length);
  const row = w * 4;
  for (let y = 0; y < h; y++) flipped.set(pixels.subarray(y * row, y * row + row), (h - 1 - y) * row);
  if (into && into.image.width === w && into.image.height === h) {
    (into.image.data as Uint8Array).set(flipped);
    into.needsUpdate = true;
    return into;
  }
  into?.dispose();
  const texture = new THREE.DataTexture(flipped, w, h, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}
