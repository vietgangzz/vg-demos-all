import { GlassView, isLiquidGlassAvailable, type GlassColorScheme } from 'expo-glass-effect';
import type { ReactNode } from 'react';
import {
  Pressable,
  StyleSheet,
  type AccessibilityState,
  type ColorValue,
  type StyleProp,
  type ViewStyle,
} from 'react-native';

const GLASS = isLiquidGlassAvailable();

type GlassButtonProps = {
  onPress: () => void;
  children: ReactNode;
  /** Tinted glass for selected states (e.g. the line colour when active) */
  tint?: ColorValue;
  colorScheme?: GlassColorScheme;
  style?: StyleProp<ViewStyle>;
  accessibilityLabel?: string;
  accessibilityRole?: 'button' | 'switch';
  accessibilityState?: AccessibilityState;
  hitSlop?: number;
};

/**
 * Liquid Glass capsule button (iOS 26+): interactive glass that reacts to touch, optionally
 * tinted. Falls back to a frosted white pill where Liquid Glass is unavailable.
 */
export function GlassButton({
  onPress,
  children,
  tint,
  colorScheme = 'auto',
  style,
  accessibilityLabel,
  accessibilityRole = 'button',
  accessibilityState,
  hitSlop,
}: GlassButtonProps) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      accessibilityState={accessibilityState}>
      <GlassView
        glassEffectStyle="regular"
        isInteractive
        tintColor={tint}
        colorScheme={colorScheme}
        style={[styles.base, !GLASS && styles.fallback, !GLASS && tint ? { backgroundColor: tint } : null, style]}>
        {children}
      </GlassView>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  base: {
    height: 36,
    minWidth: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
  },
  fallback: {
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1,
    borderColor: 'rgba(20,30,50,0.06)',
    boxShadow: '0 4px 14px rgba(20, 30, 50, 0.08)',
  },
});
