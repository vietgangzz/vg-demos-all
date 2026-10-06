import { InterTight_700Bold, InterTight_800ExtraBold, InterTight_900Black } from '@expo-google-fonts/inter-tight';
import { JetBrainsMono_400Regular, JetBrainsMono_500Medium } from '@expo-google-fonts/jetbrains-mono';
import { useFonts } from 'expo-font';

/**
 * Two faces, after the original's: a heavy, tightly set grotesque (Inter Tight) for headlines
 * and text, and a light monospace (JetBrains Mono) for the labels and numbers in the cards. Both
 * carry full Vietnamese diacritics. Custom faces carry their own weight: no fontWeight
 * alongside them.
 */
export const FONT = {
  display: 'InterTight_900Black',
  displaySemi: 'InterTight_800ExtraBold',
  body: 'InterTight_700Bold',
  bodyBold: 'InterTight_800ExtraBold',
  mono: 'JetBrainsMono_400Regular',
  monoBold: 'JetBrainsMono_500Medium',
};

/**
 * The same faces by PostScript name, for SwiftUI (expo-ui) text: Font.custom looks fonts up by
 * the name inside the file, not by the alias expo-font registered them under.
 */
export const NATIVE_FONT = {
  mono: 'JetBrainsMono-Regular',
  monoBold: 'JetBrainsMono-Medium',
};

export function useWeatherFonts() {
  const [loaded] = useFonts({
    InterTight_700Bold,
    InterTight_800ExtraBold,
    InterTight_900Black,
    JetBrainsMono_400Regular,
    JetBrainsMono_500Medium,
  });
  return loaded;
}
