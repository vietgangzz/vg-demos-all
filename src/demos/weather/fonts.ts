import { BeVietnamPro_600SemiBold, BeVietnamPro_800ExtraBold } from '@expo-google-fonts/be-vietnam-pro';
import { JetBrainsMono_600SemiBold, JetBrainsMono_800ExtraBold } from '@expo-google-fonts/jetbrains-mono';
import { Unbounded_700Bold, Unbounded_900Black } from '@expo-google-fonts/unbounded';
import { useFonts } from 'expo-font';

/**
 * Three faces, all with full Vietnamese diacritics, set heavy: Unbounded (wide and round, kin to
 * the puffy numerals) for headlines, Be Vietnam Pro (drawn for Vietnamese) for text, JetBrains
 * Mono for the numbers in the cards. Custom faces carry their own weight: no fontWeight alongside
 * them.
 */
export const FONT = {
  display: 'Unbounded_900Black',
  displaySemi: 'Unbounded_700Bold',
  body: 'BeVietnamPro_600SemiBold',
  bodyBold: 'BeVietnamPro_800ExtraBold',
  mono: 'JetBrainsMono_600SemiBold',
  monoBold: 'JetBrainsMono_800ExtraBold',
};

/**
 * The same faces by PostScript name, for SwiftUI (expo-ui) text: Font.custom looks fonts up by
 * the name inside the file, not by the alias expo-font registered them under.
 */
export const NATIVE_FONT = {
  mono: 'JetBrainsMono-SemiBold',
  monoBold: 'JetBrainsMono-ExtraBold',
};

export function useWeatherFonts() {
  const [loaded] = useFonts({
    Unbounded_900Black,
    Unbounded_700Bold,
    BeVietnamPro_600SemiBold,
    BeVietnamPro_800ExtraBold,
    JetBrainsMono_600SemiBold,
    JetBrainsMono_800ExtraBold,
  });
  return loaded;
}
