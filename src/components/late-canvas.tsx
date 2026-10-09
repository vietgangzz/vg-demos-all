import { useEffect, useState, type ReactNode } from 'react';
import { StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import { Canvas, Group } from 'react-native-skia';

/**
 * A Skia canvas that records its content again a few times after it mounts. When its native view is
 * moved between parents (a screen being pushed, say) Skia 3.0.3 makes a new one and doesn't hand it
 * the recording it was given, so the canvas stays blank until React renders it again: this does.
 */
export function LateCanvas({ style, children }: { style: StyleProp<ViewStyle>; children: ReactNode }) {
  const [pass, setPass] = useState(0);
  useEffect(() => {
    if (pass === 0 || pass >= 3) return;
    const t = setTimeout(() => setPass((n) => n + 1), pass === 1 ? 450 : 900);
    return () => clearTimeout(t);
  }, [pass]);
  return (
    <View style={style} pointerEvents="none" onLayout={() => setPass((n) => Math.max(n, 1))}>
      <Canvas style={StyleSheet.absoluteFill}>{pass > 0 ? <Group key={pass}>{children}</Group> : null}</Canvas>
    </View>
  );
}
