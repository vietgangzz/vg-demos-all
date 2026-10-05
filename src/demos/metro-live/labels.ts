import { BlurStyle, PaintStyle, Skia, type SkCanvas } from 'react-native-skia';
import { PixelRatio } from 'react-native';
import * as THREE from 'three/webgpu';

import { LINE_1, STATIONS } from '@/demos/metro/line-1';

import { GREEN, INK, MUTED } from './theme';

/**
 * Station labels and train pins drawn inside the 3D scene, as screen-facing sprites of a fixed
 * on-screen size. Drawn as React Native views over the canvas they trail the 3D image by a frame
 * or two, so with the camera following a train they visibly slid off their stations; as sprites
 * they are in the very frame they label. Each is rasterised once with Skia (system font, like the
 * rest of the UI) into a texture; only your train's countdown pin is redrawn, once a second.
 */

/** Texture pixels per point: crisp on any phone */
const SCALE = Math.min(3, Math.max(2, PixelRatio.get()));
/** Room around a chip for its soft shadow (points) */
const PAD = 8;

export type LabelTexture = {
  texture: THREE.DataTexture;
  /** Size in points, shadow padding included */
  width: number;
  height: number;
  /** The sprite's anchor (THREE.Sprite.center): which point of the image sits on the 3D point */
  center: THREE.Vector2;
};

function paragraph(text: string, size: number, weight: number, color: string) {
  const p = Skia.ParagraphBuilder.Make()
    .pushStyle({ color: Skia.Color(color), fontSize: size, fontStyle: { weight } })
    .addText(text)
    .build();
  p.layout(1000);
  return p;
}

/** Rasterise `draw` (in points, inside a `w` × `h` chip) into a texture with a shadow margin */
function rasterise(
  w: number,
  h: number,
  draw: (canvas: SkCanvas) => void,
  anchor: (width: number, height: number) => [number, number],
  target?: THREE.DataTexture
): LabelTexture {
  const width = Math.ceil(w + PAD * 2);
  const height = Math.ceil(h + PAD * 2);
  const px = Math.ceil(width * SCALE);
  const py = Math.ceil(height * SCALE);
  const surface = Skia.Surface.Make(px, py);
  const pixels = new Uint8Array(px * py * 4);
  if (surface) {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    canvas.scale(SCALE, SCALE);
    canvas.translate(PAD, PAD);
    draw(canvas);
    surface.flush();
    const read = surface.makeImageSnapshot().readPixels();
    if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  }
  // Skia rows run top-down, texture rows bottom-up
  const flipped = new Uint8Array(pixels.length);
  const row = px * 4;
  for (let y = 0; y < py; y++) flipped.set(pixels.subarray(y * row, y * row + row), (py - 1 - y) * row);
  let texture = target;
  if (texture && texture.image.width === px && texture.image.height === py) {
    (texture.image.data as Uint8Array).set(flipped);
  } else {
    texture?.dispose();
    texture = new THREE.DataTexture(flipped, px, py, THREE.RGBAFormat);
    texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter;
    texture.generateMipmaps = false;
    texture.premultiplyAlpha = false;
  }
  texture.needsUpdate = true;
  const [ax, ay] = anchor(width, height);
  return { texture, width, height, center: new THREE.Vector2(ax / width, 1 - ay / height) };
}

function chip(canvas: SkCanvas, w: number, h: number, r: number, fill: string, shadow: string, blur: number) {
  const shape = Skia.RRectXY(Skia.XYWHRect(0, 0, w, h), r, r);
  const glow = Skia.Paint();
  glow.setColor(Skia.Color(shadow));
  glow.setMaskFilter(Skia.MaskFilter.MakeBlur(BlurStyle.Normal, blur, true));
  canvas.save();
  canvas.translate(0, 2);
  canvas.drawRRect(shape, glow);
  canvas.restore();
  const paint = Skia.Paint();
  paint.setColor(Skia.Color(fill));
  canvas.drawRRect(shape, paint);
}

/**
 * A station label, idle or with a train at the platform (green border and dot). Its anchor is
 * the station's 3D point: 12 pt in from the label's left edge and 6 pt below it, as the labels
 * have always sat.
 */
export function stationLabel(index: number, busy: boolean): LabelTexture {
  const station = STATIONS[index];
  const code = paragraph(station.code, 10, 800, '#FFFFFF');
  const name = paragraph(station.name, 11, 600, INK);
  const ug = station.underground ? paragraph('UG', 9, 700, MUTED) : null;
  const codeW = Math.max(20, code.getMaxIntrinsicWidth() + 6);
  const nameW = name.getMaxIntrinsicWidth();
  const ugW = ug ? ug.getMaxIntrinsicWidth() + 5 : 0;
  const dotW = busy ? 8 : 0;
  const w = 1 + 3 + codeW + 5 + nameW + ugW + dotW + 8 + 1;
  const h = 24;
  return rasterise(
    w,
    h,
    (canvas) => {
      chip(canvas, w, h, 10, busy ? 'rgba(230,246,236,0.97)' : 'rgba(255,255,255,0.94)', 'rgba(20,30,50,0.14)', 3);
      if (busy) {
        const border = Skia.Paint();
        border.setColor(Skia.Color(GREEN));
        border.setStyle(PaintStyle.Stroke);
        border.setStrokeWidth(1);
        canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(0.5, 0.5, w - 1, h - 1), 9.5, 9.5), border);
      }
      const badge = Skia.Paint();
      badge.setColor(Skia.Color(LINE_1.color));
      canvas.drawRRect(Skia.RRectXY(Skia.XYWHRect(4, 4, codeW, 16), 5, 5), badge);
      code.paint(canvas, 4 + (codeW - code.getMaxIntrinsicWidth()) / 2, 4 + (16 - code.getHeight()) / 2);
      let x = 4 + codeW + 5;
      name.paint(canvas, x, (h - name.getHeight()) / 2);
      x += nameW;
      if (ug) {
        ug.paint(canvas, x + 5, (h - ug.getHeight()) / 2);
        x += ugW;
      }
      if (busy) {
        const dot = Skia.Paint();
        dot.setColor(Skia.Color(GREEN));
        canvas.drawCircle(x + 2 + 3, h / 2, 3, dot);
      }
    },
    (_, height) => [PAD + 12, height - PAD + 6]
  );
}

/** A train pin: a chip with a little tail; the tail's tip is the anchor (just above the train) */
export function trainPin(text: string, mine: boolean, target?: THREE.DataTexture): LabelTexture {
  const label = paragraph(text, 11, 700, mine ? '#FFFFFF' : INK);
  const padX = mine ? 9 : 7;
  const padY = mine ? 4 : 3;
  const w = label.getMaxIntrinsicWidth() + padX * 2;
  const chipH = label.getHeight() + padY * 2;
  const h = chipH + 5;
  const fill = mine ? GREEN : 'rgba(255,255,255,0.96)';
  return rasterise(
    w,
    h,
    (canvas) => {
      chip(canvas, w, chipH, 9, fill, mine ? 'rgba(31,163,91,0.4)' : 'rgba(20,30,50,0.18)', mine ? 5 : 3);
      const tail = Skia.PathBuilder.Make()
        .moveTo(w / 2 - 4, chipH - 0.5)
        .lineTo(w / 2 + 4, chipH - 0.5)
        .lineTo(w / 2, chipH + 5)
        .close()
        .detach();
      const paint = Skia.Paint();
      paint.setColor(Skia.Color(fill));
      canvas.drawPath(tail, paint);
      label.paint(canvas, padX, padY);
    },
    (width, height) => [width / 2, height - PAD],
    target
  );
}

/** A screen-facing sprite of constant on-screen size for a label texture */
export function labelSprite(label: LabelTexture, renderOrder: number) {
  const material = new THREE.SpriteNodeMaterial({
    map: label.texture,
    transparent: true,
    depthTest: false,
    depthWrite: false,
    sizeAttenuation: false,
    fog: false,
  });
  const sprite = new THREE.Sprite(material);
  sprite.center.copy(label.center);
  sprite.renderOrder = renderOrder;
  sprite.frustumCulled = false;
  sprite.userData.size = [label.width, label.height];
  return sprite;
}

/** Swap a sprite onto a (re-rendered) label texture */
export function setSpriteLabel(sprite: THREE.Sprite, label: LabelTexture) {
  const material = sprite.material as THREE.SpriteNodeMaterial;
  if (material.map !== label.texture) {
    material.map = label.texture;
    material.needsUpdate = true;
  }
  sprite.center.copy(label.center);
  sprite.userData.size = [label.width, label.height];
}

/**
 * Sprite scale for a constant on-screen size: with sizeAttenuation off, three.js multiplies the
 * scale by the view depth, so a scale of `points × 2 tan(fov/2) / viewportHeight` covers exactly
 * that many points.
 */
export function sizeSprite(sprite: THREE.Sprite, camera: THREE.PerspectiveCamera, viewportHeight: number) {
  const [w, h] = sprite.userData.size as [number, number];
  const k = (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) / viewportHeight;
  sprite.scale.set(w * k, h * k, 1);
}
