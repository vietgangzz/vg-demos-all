import { useSyncExternalStore } from 'react';

/**
 * The app's language, English or Vietnamese, switched from the home screen. Components read
 * it with useLang(), which re-renders them on a switch; pass the result into string lookups
 * (the React Compiler memoizes by inputs, so a lookup that read the language itself would keep
 * showing the old one).
 */
export type Lang = 'en' | 'vi';

let current: Lang = 'en';
const listeners = new Set<() => void>();

export const language = {
  get: () => current,
  set(next: Lang) {
    if (next === current) return;
    current = next;
    listeners.forEach((l) => l());
  },
  toggle() {
    language.set(current === 'en' ? 'vi' : 'en');
  },
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
};

/** The current language; re-renders the caller when it changes */
export function useLang() {
  return useSyncExternalStore(language.subscribe, language.get);
}
