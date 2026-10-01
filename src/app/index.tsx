import { router } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { demos, type Demo } from '@/demos/registry';
import { useTheme } from '@/hooks/use-theme';

export default function HomeScreen() {
  // Side insets (iPhone Duo's camera column, landscape notches) aren't applied by the scroll view
  const insets = useSafeAreaInsets();
  return (
    <FlatList
      data={demos}
      keyExtractor={(item) => item.id}
      contentInsetAdjustmentBehavior="automatic"
      contentContainerStyle={[
        styles.list,
        { paddingLeft: Spacing.three + insets.left, paddingRight: Spacing.three + insets.right },
      ]}
      renderItem={({ item, index }) => <DemoRow demo={item} index={index} />}
      ListEmptyComponent={
        <ThemedText themeColor="textSecondary" style={styles.empty}>
          No demos yet. Add one in src/demos/registry.ts
        </ThemedText>
      }
    />
  );
}

function DemoRow({ demo, index }: { demo: Demo; index: number }) {
  const theme = useTheme();

  return (
    <Pressable
      accessibilityRole="button"
      onPress={() => router.push({ pathname: '/demo/[id]', params: { id: demo.id } })}
      style={({ pressed }) => [
        styles.row,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <ThemedText type="code" themeColor="textSecondary" style={styles.index}>
        {String(index + 1).padStart(2, '0')}
      </ThemedText>
      <View style={styles.rowBody}>
        <ThemedText type="smallBold" style={styles.rowTitle}>
          {demo.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {demo.description}
        </ThemedText>
        {demo.author ? (
          <ThemedText type="code" themeColor="textSecondary" style={styles.author}>
            {demo.author}
          </ThemedText>
        ) : null}
      </View>
      <ThemedText themeColor="textSecondary">›</ThemedText>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: {
    padding: Spacing.three,
    gap: Spacing.two,
    width: '100%',
    maxWidth: MaxContentWidth,
    alignSelf: 'center',
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: Spacing.three,
    padding: Spacing.three,
    borderRadius: Spacing.three,
    borderCurve: 'continuous',
  },
  index: {
    width: 20,
  },
  rowBody: {
    flex: 1,
    gap: Spacing.half,
  },
  rowTitle: {
    fontSize: 16,
  },
  author: {
    marginTop: Spacing.one,
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
