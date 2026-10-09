import { PixelRatio } from 'react-native';
import { Skia } from 'react-native-skia';
import * as THREE from 'three/webgpu';

/**
 * The engraving on the top dials, rasterised once with Skia: a ring of figures round the edge
 * (the shutter speeds, or the exposure compensation), the marks between them, and an index line.
 * White on transparent, the picked-out figure red; the shader inks them in the finish's colours.
 */

const SIZE = Math.min(1024, 384 * Math.max(2, PixelRatio.get()));

function paragraph(text: string, size: number, weight: number, color = '#FFFFFF') {
  const p = Skia.ParagraphBuilder.Make()
    .pushStyle({ color: Skia.Color(color), fontSize: size, fontStyle: { weight }, letterSpacing: 0.2 })
    .addText(text)
    .build();
  p.layout(1000);
  return p;
}

/** A ring of `items` round a dial face; `accent` (an index into items) is drawn pure red, the rest white */
export function dialTexture(items: string[], accent = -1) {
  const surface = Skia.Surface.Make(SIZE, SIZE);
  const pixels = new Uint8Array(SIZE * SIZE * 4);
  if (surface) {
    const canvas = surface.getCanvas();
    canvas.clear(Skia.Color('transparent'));
    const c = SIZE / 2;
    const step = 360 / (items.length + 2);
    const tick = Skia.Paint();
    tick.setColor(Skia.Color('#FFFFFF'));
    tick.setStrokeWidth(SIZE * 0.006);
    items.forEach((label, i) => {
      const angle = -90 + (i - (items.length - 1) / 2) * step;
      canvas.save();
      canvas.rotate(angle + 90, c, c);
      const p = paragraph(label, SIZE * (label.length > 3 ? 0.062 : 0.075), 600, i === accent ? '#FF0000' : '#FFFFFF');
      const w = p.getMaxIntrinsicWidth();
      p.paint(canvas, c - w / 2, SIZE * 0.07);
      canvas.restore();
      // A fine mark half a step on
      canvas.save();
      canvas.rotate(angle + 90 + step / 2, c, c);
      canvas.drawLine(c, SIZE * 0.035, c, SIZE * 0.06, tick);
      canvas.restore();
    });
    surface.flush();
    const read = surface.makeImageSnapshot().readPixels();
    if (read instanceof Uint8Array && read.length === pixels.length) pixels.set(read);
  }
  const texture = new THREE.DataTexture(pixels, SIZE, SIZE, THREE.RGBAFormat);
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.needsUpdate = true;
  return texture;
}

export const SPEEDS = ['A', '4000', '2000', '1000', '500', '250', '125', '60', '30', '15', '8', '4', '2', '1', 'B'];
