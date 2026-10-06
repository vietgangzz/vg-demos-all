import { TrueSheet } from '@lodev09/react-native-true-sheet';
import { SymbolView, type SFSymbol } from 'expo-symbols';
import { forwardRef, type ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import { Canvas, Group, LinearGradient, Oval, Path, Skia, vec, type SkPath } from 'react-native-skia';

import type { EnvKind } from './data';
import { FONT } from './fonts';
import { THEMES, type Theme, type ThemeId } from './themes';

/**
 * The settings sheet, after (Not Boring) Weather's: a dark form sheet with the skins in a row of
 * cards (each with a little cube in its colours), the sky to preview, and the settings below.
 * Set in the system face at modest weights, as iOS settings are. Everything here is free.
 */

export type Units = 'metric' | 'imperial';

export type SettingsProps = {
  theme: ThemeId;
  onTheme: (id: ThemeId) => void;
  city: string;
  onCity: () => void;
  units: Units;
  onUnits: (u: Units) => void;
  minimal: boolean;
  onMinimal: (on: boolean) => void;
  glow: boolean;
  onGlow: (on: boolean) => void;
  /** The sky preview: which preset, if any, and whether the tour is running */
  env: EnvKind | null;
  envs: EnvKind[];
  envLabel: (k: EnvKind) => string;
  touring: boolean;
  onEnv: (k: EnvKind | null) => void;
  onTour: () => void;
};

const ACCENT = '#FFB300';

export const SettingsSheet = forwardRef<TrueSheet, SettingsProps>(function SettingsSheet(props, ref) {
  const tap = () => Presets.System.selection();
  const close = () => {
    tap();
    if (ref && typeof ref !== 'function') ref.current?.dismiss();
  };
  return (
    <TrueSheet
      ref={ref}
      name="weather-settings"
      detents={[1]}
      backgroundColor="#0B0B0D"
      cornerRadius={34}
      grabber={false}
      scrollable>
      <View style={styles.header}>
        <Text style={styles.title}>!Sky</Text>
        <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={close} hitSlop={10} style={styles.close}>
          <SymbolView name="xmark" size={13} weight="bold" tintColor="#D1D1D6" />
        </Pressable>
      </View>
      <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={styles.content}>
        <FreeCard />

        <Text style={styles.section}>Skins</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.skins}>
          {THEMES.map((theme) => (
            <SkinCard
              key={theme.id}
              theme={theme}
              selected={props.theme === theme.id}
              onPress={() => {
                Presets.System.impactLight();
                props.onTheme(theme.id);
              }}
            />
          ))}
        </ScrollView>

        <Text style={styles.section}>Preview the sky</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.pills}>
          <Pill icon="play.fill" label="Tour" active={props.touring} onPress={props.onTour} />
          <Pill label="Live" active={!props.env && !props.touring} onPress={() => props.onEnv(null)} />
          {props.envs.map((k) => (
            <Pill
              key={k}
              label={props.envLabel(k)}
              active={props.env === k && !props.touring}
              onPress={() => props.onEnv(k)}
            />
          ))}
        </ScrollView>

        <Text style={styles.section}>Settings</Text>
        <View style={styles.group}>
          <Row icon="location.fill" tint="#0A84FF" label="Location" onPress={() => (tap(), props.onCity())}>
            <Value text={props.city} chevron />
          </Row>
          <Row
            icon="thermometer.medium"
            tint="#FF453A"
            label="Units"
            onPress={() => {
              tap();
              props.onUnits(props.units === 'metric' ? 'imperial' : 'metric');
            }}>
            <Value text={props.units === 'metric' ? '°C · km/h' : '°F · mph'} chevron />
          </Row>
          <Row icon="eye.slash" tint="#A3E635" label="Minimalist Mode">
            <Toggle value={props.minimal} onChange={(v) => (tap(), props.onMinimal(v))} />
          </Row>
          <Row icon="sparkles" tint="#FFD60A" label="Glow" last>
            <Toggle value={props.glow} onChange={(v) => (tap(), props.onGlow(v))} />
          </Row>
        </View>

        <View style={styles.footer}>
          <Text style={styles.footerText}>Made with love by VG Team</Text>
          <Text style={styles.footerSmall}>React Native · three.js WebGPU · Skia</Text>
        </View>
      </ScrollView>
    </TrueSheet>
  );
});

/** The banner at the top: a white card with fine rainbow waves, where the original sells PLUS */
function FreeCard() {
  const w = 380;
  const waves = Array.from({ length: 11 }, (_, i) => {
    const b = Skia.PathBuilder.Make();
    const y0 = 4 + i * 7;
    for (let x = 0; x <= w; x += 5) {
      const y = y0 + Math.sin(x / 38 + i * 0.6) * 4;
      if (x === 0) b.moveTo(x, y);
      else b.lineTo(x, y);
    }
    return b.build();
  });
  return (
    <View style={styles.free}>
      <Canvas style={StyleSheet.absoluteFill}>
        {waves.map((p, i) => (
          <Path key={i} path={p} style="stroke" strokeWidth={0.8} opacity={0.45}>
            <LinearGradient
              start={vec(0, 0)}
              end={vec(w, 0)}
              colors={['#FFFFFF', i % 2 ? '#C7B8FF' : '#FFB3D9', '#FFE38A', '#FFFFFF']}
            />
          </Path>
        ))}
      </Canvas>
      <View style={styles.freeTitleRow}>
        <Text style={styles.freeTitle}>Get</Text>
        <View style={styles.freeBadge}>
          <Text style={styles.freeBadgeText}>FREE</Text>
        </View>
        <View style={styles.spacer} />
        <SymbolView name="heart.fill" size={20} tintColor="#1C1C1E" />
      </View>
      <Text style={styles.freeSub}>Every skin and feature, on the house</Text>
    </View>
  );
}

const shape = (pts: [number, number][]) => {
  const b = Skia.PathBuilder.Make();
  pts.forEach(([x, y], i) => (i ? b.lineTo(x, y) : b.moveTo(x, y)));
  return b.close().build();
};

/** A soft, rounded isometric cube: three shaded faces, a glint, a contact shadow */
function Cube({ colors: [top, left, right] }: { colors: [string, string, string] }) {
  const c = 48;
  const s = 25;
  const dx = s * 0.866;
  const cy = 46;
  const faces: [SkPath, string, string, [number, number, number, number]][] = [
    [
      shape([
        [c, cy - s],
        [c + dx, cy - s / 2],
        [c, cy],
        [c - dx, cy - s / 2],
      ]),
      top,
      left,
      [c - dx, cy - s, c + dx, cy],
    ],
    [
      shape([
        [c - dx, cy - s / 2],
        [c, cy],
        [c, cy + s],
        [c - dx, cy + s / 2],
      ]),
      left,
      right,
      [c - dx, cy - s / 2, c, cy + s],
    ],
    [
      shape([
        [c, cy],
        [c + dx, cy - s / 2],
        [c + dx, cy + s / 2],
        [c, cy + s],
      ]),
      right,
      left,
      [c, cy, c + dx, cy + s],
    ],
  ];
  return (
    <Canvas style={styles.cube}>
      <Oval x={c - dx * 1.05} y={cy + s - 4} width={dx * 2.1} height={12} color="rgba(0,0,0,0.22)" />
      {faces.map(([p, a, b, [x0, y0, x1, y1]], i) => (
        <Group key={i}>
          {/* Stroked in its own colour with round joins: the edges come out rounded */}
          <Path path={p} style="stroke" strokeWidth={7} strokeJoin="round" color={a} />
          <Path path={p}>
            <LinearGradient start={vec(x0, y0)} end={vec(x1, y1)} colors={[a, b]} />
          </Path>
        </Group>
      ))}
      <Path
        path={shape([
          [c - 6, cy - s + 5],
          [c + dx - 9, cy - s / 2 + 1],
          [c + dx - 12, cy - s / 2 + 3.5],
          [c - 9, cy - s + 7.5],
        ])}
        style="stroke"
        strokeWidth={2.5}
        strokeJoin="round"
        color="rgba(255,255,255,0.6)"
      />
    </Canvas>
  );
}

/** A skin's card: its colour, the cube in its colours, its name */
function SkinCard({ theme, selected, onPress }: { theme: Theme; selected: boolean; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={theme.name.en}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => [
        styles.skin,
        { backgroundColor: theme.card.bg, transform: [{ scale: pressed ? 0.96 : 1 }] },
        selected && styles.skinSelected,
      ]}>
      <Cube colors={theme.card.cube} />
      <Text style={[styles.skinLabel, { color: theme.card.ink }]} numberOfLines={1}>
        {theme.name.en}
      </Text>
    </Pressable>
  );
}

function Pill({ label, icon, active, onPress }: { label: string; icon?: SFSymbol; active: boolean; onPress: () => void }) {
  const ink = active ? '#0B0B0D' : '#F2F2F7';
  return (
    <Pressable
      onPress={() => {
        Presets.System.selection();
        onPress();
      }}
      style={[styles.pill, active && styles.pillActive]}>
      {icon ? <SymbolView name={icon} size={11} tintColor={ink} /> : null}
      <Text style={[styles.pillText, { color: ink }]}>{label}</Text>
    </Pressable>
  );
}

function Row({
  icon,
  tint,
  label,
  onPress,
  last,
  children,
}: {
  icon: SFSymbol;
  tint: string;
  label: string;
  onPress?: () => void;
  last?: boolean;
  children: ReactNode;
}) {
  return (
    <Pressable onPress={onPress} disabled={!onPress} style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}>
      <View style={styles.rowIcon}>
        <SymbolView name={icon} size={16} tintColor={tint} />
      </View>
      <View style={[styles.rowBody, !last && styles.rowLine]}>
        <Text style={styles.rowLabel}>{label}</Text>
        {children}
      </View>
    </Pressable>
  );
}

function Value({ text, chevron }: { text: string; chevron?: boolean }) {
  return (
    <View style={styles.value}>
      <Text style={styles.valueText}>{text}</Text>
      {chevron ? <SymbolView name="chevron.right" size={11} weight="semibold" tintColor="#5A5A60" /> : null}
    </View>
  );
}

function Toggle({ value, onChange }: { value: boolean; onChange: (v: boolean) => void }) {
  return <Switch value={value} onValueChange={onChange} trackColor={{ true: ACCENT, false: '#3A3A3C' }} />;
}

const styles = StyleSheet.create({
  header: {
    height: 60,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: {
    fontFamily: FONT.display,
    fontSize: 18,
    letterSpacing: -0.4,
    color: '#FFFFFF',
  },
  close: {
    position: 'absolute',
    right: 16,
    top: 14,
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#2C2C2E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  content: {
    paddingHorizontal: 16,
    paddingBottom: 48,
  },
  free: {
    borderRadius: 18,
    borderCurve: 'continuous',
    overflow: 'hidden',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 13,
    paddingBottom: 14,
    gap: 3,
  },
  spacer: {
    flex: 1,
  },
  freeTitleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 7,
  },
  freeTitle: {
    fontFamily: FONT.display,
    fontSize: 22,
    letterSpacing: -0.6,
    color: '#1C1C1E',
  },
  freeBadge: {
    borderWidth: 2,
    borderColor: '#1C1C1E',
    borderRadius: 14,
    paddingHorizontal: 9,
    paddingVertical: 1,
  },
  freeBadgeText: {
    fontFamily: FONT.display,
    fontSize: 15,
    letterSpacing: -0.2,
    color: '#1C1C1E',
  },
  freeSub: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.15,
    color: '#3A3A3C',
  },
  section: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: 1.8,
    textTransform: 'uppercase',
    color: '#7C7C82',
    marginTop: 26,
    marginBottom: 10,
    marginLeft: 4,
  },
  skins: {
    gap: 10,
    paddingRight: 16,
  },
  // The border is always there (clear until selected): a canvas that changes size mid-sheet
  // comes back blank
  skin: {
    width: 104,
    height: 128,
    borderRadius: 16,
    borderCurve: 'continuous',
    borderWidth: 2,
    borderColor: 'transparent',
    justifyContent: 'space-between',
    paddingBottom: 8,
  },
  skinSelected: {
    borderColor: '#FFFFFF',
  },
  cube: {
    width: 96,
    height: 92,
    alignSelf: 'center',
    marginTop: 6,
  },
  skinLabel: {
    fontSize: 13,
    fontWeight: '600',
    letterSpacing: -0.1,
    marginLeft: 11,
  },
  pills: {
    gap: 8,
    paddingRight: 16,
  },
  pill: {
    height: 32,
    paddingHorizontal: 14,
    borderRadius: 16,
    backgroundColor: '#1C1C1E',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  pillActive: {
    backgroundColor: '#F2F2F7',
  },
  pillText: {
    fontSize: 14,
    fontWeight: '500',
    letterSpacing: -0.15,
  },
  group: {
    borderRadius: 14,
    borderCurve: 'continuous',
    backgroundColor: '#1C1C1E',
    overflow: 'hidden',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    minHeight: 48,
    paddingLeft: 14,
  },
  rowPressed: {
    backgroundColor: '#2C2C2E',
  },
  rowIcon: {
    width: 26,
    alignItems: 'center',
  },
  rowBody: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: 48,
    marginLeft: 10,
    paddingRight: 14,
  },
  rowLine: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#38383A',
  },
  rowLabel: {
    fontSize: 16,
    fontWeight: '400',
    letterSpacing: -0.3,
    color: '#FFFFFF',
  },
  value: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  valueText: {
    fontSize: 15,
    fontWeight: '400',
    letterSpacing: -0.2,
    color: '#8E8E93',
  },
  footer: {
    alignItems: 'center',
    gap: 5,
    marginTop: 30,
  },
  footerText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#8E8E93',
  },
  footerSmall: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: 0.8,
    color: '#56565C',
  },
});
