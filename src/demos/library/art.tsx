import { Capsule, Circle, HStack, Rectangle, Text, ZStack } from '@expo/ui/swift-ui';
import {
  accessibilityHidden,
  blur,
  clipShape,
  font,
  foregroundStyle,
  frame,
  offset,
  opacity,
  rotationEffect,
  strokeBorder,
  type ShapeStyle,
} from '@expo/ui/swift-ui/modifiers';

import type { Album } from './songs';

const linear = (colors: string[], from = { x: 0, y: 0 }, to = { x: 1, y: 1 }): ShapeStyle => ({
  type: 'linearGradient',
  colors,
  startPoint: from,
  endPoint: to,
});

/**
 * An album cover, drawn natively with shapes and gradients and never loaded, so a row that's
 * recycled for another song has its cover at once, however fast the list is flung. Everything is
 * laid out in fractions of `size`, so the 46 pt thumbnail and the big cover in the player are the
 * same picture.
 */
/** Whether the cover leaves room for the album's name to be set on it, as on a poster */
export const takesTitle = (album: Album) => album.style !== 'letter' && album.style !== 'vinyl';

export function Art({ album, size: s, radius }: { album: Album; size: number; radius: number }) {
  const [light, mid, deep] = album.colours;
  const [u, v] = album.shift;
  const box = [frame({ width: s, height: s }), clipShape('roundedRectangle', radius), accessibilityHidden()];

  /** A disc `d` across, its centre moved by (x, y), all in fractions of the cover */
  const disc = (d: number, fill: ShapeStyle, x: number, y: number, more: ReturnType<typeof blur>[] = []) => (
    <Circle
      modifiers={[
        foregroundStyle(fill),
        frame({ width: d * s, height: d * s }),
        offset({ x: x * s, y: y * s }),
        ...more,
      ]}
    />
  );

  switch (album.style) {
    // Soft light pooling in the dark, like a mesh gradient
    case 'orbs':
      return (
        <ZStack modifiers={box}>
          <Rectangle modifiers={[foregroundStyle(linear([deep, '#120C1C']))]} />
          {disc(0.95, light, -0.28 + u * 0.12, -0.26 + v * 0.1, [blur(s * 0.17)])}
          {disc(0.7, mid, 0.34 - v * 0.1, 0.3, [blur(s * 0.15)])}
          {disc(0.45, deep, 0.3 + u * 0.1, -0.34, [blur(s * 0.12)])}
        </ZStack>
      );

    // A sunset sun sinking behind slats, eighties-style
    case 'sun': {
      const slats = [0.06, 0.15, 0.23, 0.3, 0.36];
      return (
        <ZStack modifiers={box}>
          <Rectangle modifiers={[foregroundStyle(linear([deep, '#140A1E'], { x: 0.5, y: 0 }, { x: 0.5, y: 1 }))]} />
          {disc(0.66, linear([light, mid], { x: 0.5, y: 0 }, { x: 0.5, y: 1 }), u * 0.08, 0.1)}
          {slats.map((y, i) => (
            <Rectangle
              key={i}
              modifiers={[
                foregroundStyle('#140A1E'),
                frame({ width: s, height: s * (0.012 + i * 0.011) }),
                offset({ y: s * y }),
              ]}
            />
          ))}
        </ZStack>
      );
    }

    // Rings rippling out from somewhere off-centre
    case 'rings':
      return (
        <ZStack modifiers={box}>
          <Rectangle modifiers={[foregroundStyle(linear([mid, deep]))]} />
          {[0.28, 0.56, 0.84, 1.12, 1.4].map((d, i) => (
            <Circle
              key={i}
              modifiers={[
                foregroundStyle('#00000000'),
                strokeBorder({ content: light, style: { lineWidth: s * 0.03 }, shape: 'circle' }),
                frame({ width: d * s, height: d * s }),
                offset({ x: s * (0.22 * u - 0.2), y: s * (0.22 * v + 0.18) }),
                opacity(1 - i * 0.17),
              ]}
            />
          ))}
        </ZStack>
      );

    // Seventies stripes swooping across
    case 'stripes': {
      const bands = [light, mid, deep, light, mid, deep];
      return (
        <ZStack modifiers={box}>
          <Rectangle modifiers={[foregroundStyle(deep)]} />
          <HStack spacing={s * 0.05} modifiers={[rotationEffect(-32 + u * 14), offset({ x: s * 0.08 * v })]}>
            {bands.map((c, i) => (
              <Capsule key={i} modifiers={[foregroundStyle(c), frame({ width: s * 0.12, height: s * 1.7 })]} />
            ))}
          </HStack>
        </ZStack>
      );
    }

    // One huge letter, cropped by the edge like a poster
    case 'letter':
      return (
        <ZStack modifiers={box}>
          <Rectangle modifiers={[foregroundStyle(linear([light, mid]))]} />
          <Text
            modifiers={[
              font({ size: s * 0.92, weight: 'heavy', design: 'rounded' }),
              foregroundStyle(linear([mid, deep], { x: 0, y: 0 }, { x: 0.4, y: 1 })),
              offset({ x: s * (0.2 + u * 0.05), y: s * 0.16 }),
              frame({ width: s * 1.4, height: s * 1.4 }),
              accessibilityHidden(),
            ]}>
            {album.title.charAt(0)}
          </Text>
        </ZStack>
      );

    // A record, its grooves catching the light, the label in the middle
    case 'vinyl':
      return (
        <ZStack modifiers={box}>
          <Rectangle modifiers={[foregroundStyle(light)]} />
          {disc(
            0.86,
            {
              type: 'angularGradient',
              colors: ['#111114', '#3A3A44', '#111114', '#2A2A33', '#111114'],
              center: { x: 0.5, y: 0.5 },
            },
            0.1 * u,
            0.08 * v
          )}
          {disc(0.32, linear([mid, deep]), 0.1 * u, 0.08 * v)}
          {disc(0.05, light, 0.1 * u, 0.08 * v)}
        </ZStack>
      );
  }
}
