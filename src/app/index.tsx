import { router, Stack } from 'expo-router';
import { FlatList, Pressable, StyleSheet, View } from 'react-native';
import { Presets } from 'react-native-pulsar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { SymbolView } from 'expo-symbols';

import { ThemedText } from '@/components/themed-text';
import { MaxContentWidth, Spacing } from '@/constants/theme';
import { demos, type Demo } from '@/demos/registry';
import { useTheme } from '@/hooks/use-theme';
import { language, useLang, type Lang } from '@/i18n/language';

export default function HomeScreen() {
  // Side insets (iPhone Duo's camera column, landscape notches) aren't applied by the scroll view
  const insets = useSafeAreaInsets();
  const lang = useLang();
  return (
    <>
      <Stack.Screen options={{ headerRight: () => <LanguageButton lang={lang} /> }} />
      <FlatList
        data={demos}
        keyExtractor={(item) => item.id}
        contentInsetAdjustmentBehavior="automatic"
        contentContainerStyle={[
          styles.list,
          { paddingLeft: Spacing.three + insets.left, paddingRight: Spacing.three + insets.right },
        ]}
        renderItem={({ item, index }) => <DemoRow demo={item} index={index} lang={lang} />}
        ListEmptyComponent={
          <ThemedText themeColor="textSecondary" style={styles.empty}>
            {lang === 'vi'
              ? 'Chưa có demo nào. Thêm trong src/demos/registry.ts'
              : 'No demos yet. Add one in src/demos/registry.ts'}
          </ThemedText>
        }
      />
    </>
  );
}

/** EN / VI: the whole app's language, demos included */
function LanguageButton({ lang }: { lang: Lang }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={lang === 'en' ? 'Tiếng Việt' : 'English'}
      hitSlop={8}
      onPress={() => {
        Presets.System.selection();
        language.toggle();
      }}
      style={({ pressed }) => [
        styles.langButton,
        { backgroundColor: pressed ? theme.backgroundSelected : theme.backgroundElement },
      ]}>
      <SymbolView name="globe" size={15} tintColor={theme.text} />
      <ThemedText type="smallBold">{lang === 'en' ? 'EN' : 'VI'}</ThemedText>
    </Pressable>
  );
}

function DemoRow({ demo, index, lang }: { demo: Demo; index: number; lang: Lang }) {
  const theme = useTheme();
  const text = lang === 'vi' && demo.vi ? demo.vi : demo;

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
          {text.title}
        </ThemedText>
        <ThemedText type="small" themeColor="textSecondary" numberOfLines={2}>
          {text.description}
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
  langButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    height: 30,
    borderRadius: 15,
    borderCurve: 'continuous',
  },
  empty: {
    textAlign: 'center',
    marginTop: Spacing.six,
  },
});
