import { requireNativeViewManager, requireOptionalNativeModule } from 'expo-modules-core';
import { Platform, StyleSheet, type ViewProps } from 'react-native';

export type HingeStatus = 'closed' | 'partiallyOpen' | 'fullyOpen' | 'unknown';
export type Hinge = { angle: number; status: HingeStatus };

const native = Platform.OS === 'ios' ? requireOptionalNativeModule<{ supported: boolean }>('DuoHinge') : null;

/** Whether this build can read a hinge at all (a phone that doesn't fold just never reports) */
export const hingeSupported = native?.supported === true;

type NativeProps = ViewProps & { onHinge?: (e: { nativeEvent: Hinge }) => void };
const NativeHingeView = hingeSupported ? requireNativeViewManager<NativeProps>('DuoHinge') : null;

/**
 * Put one of these on the screen that wants the hinge: it reports every change, the angle in
 * radians (0 shut, π flat open) and the status. The rate and precision are up to the system
 * (about 5°), so smooth it before driving anything with it. It draws nothing and takes no touches.
 */
export function HingeView({ onHinge }: { onHinge: (hinge: Hinge) => void }) {
  if (!NativeHingeView) return null;
  return (
    <NativeHingeView pointerEvents="none" style={StyleSheet.absoluteFill} onHinge={(e) => onHinge(e.nativeEvent)} />
  );
}
