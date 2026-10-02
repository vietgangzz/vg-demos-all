import { router, useLocalSearchParams } from 'expo-router';
import { PlatformColor, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolView } from 'expo-symbols';

import { GlassButton } from '@/components/glass-button';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { getDemo } from '@/demos/registry';

export default function DemoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const insets = useSafeAreaInsets();
  const demo = getDemo(id);

  const close = () => (router.canGoBack() ? router.back() : router.replace('/'));

  if (!demo) {
    return (
      <ThemedView style={styles.notFound}>
        <ThemedText type="subtitle">Demo not found</ThemedText>
        <Pressable onPress={close}>
          <ThemedText type="linkPrimary">Back to list</ThemedText>
        </Pressable>
      </ThemedView>
    );
  }

  const DemoComponent = demo.component;

  return (
    <View style={styles.container}>
      <DemoComponent />
      {demo.hideClose ? null : (
        <View style={[styles.closeButton, { top: insets.top + 8, right: 16 + insets.right }]}>
          <GlassButton onPress={close} hitSlop={12} accessibilityLabel="Close demo">
            <SymbolView name="xmark" size={15} weight="semibold" tintColor={PlatformColor('label')} />
          </GlassButton>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
  closeButton: {
    position: 'absolute',
  },
  notFound: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
});
