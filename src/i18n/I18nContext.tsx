import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
import { formatTranslation, locales, type Language, type TranslationKey } from './locales';

const STORAGE_KEY = 'geosurgical.language';

type I18nContextValue = {
  language: Language;
  setLanguage(language: Language): void;
  t(key: TranslationKey | string, params?: Record<string, string | number>): string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(getInitialLanguage);

  const value = useMemo<I18nContextValue>(() => ({
    language,
    setLanguage(nextLanguage) {
      localStorage.setItem(STORAGE_KEY, nextLanguage);
      setLanguageState(nextLanguage);
    },
    t(key, params) {
      const translations = locales[language] as Record<string, string>;
      const fallback = locales.zh as Record<string, string>;
      return formatTranslation(translations[key] ?? fallback[key] ?? key, params);
    },
  }), [language]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const value = useContext(I18nContext);

  if (!value) {
    throw new Error('I18nProvider is missing.');
  }

  return value;
}

function getInitialLanguage(): Language {
  const stored = localStorage.getItem(STORAGE_KEY);
  const valid: Language[] = ['zh', 'en', 'ja', 'ko', 'fr', 'es'];
  if (stored && (valid as string[]).includes(stored)) return stored as Language;
  const lang = navigator.language.toLowerCase();
  if (lang.startsWith('zh')) return 'zh';
  if (lang.startsWith('ja')) return 'ja';
  if (lang.startsWith('ko')) return 'ko';
  if (lang.startsWith('fr')) return 'fr';
  if (lang.startsWith('es')) return 'es';
  return 'en';
}
