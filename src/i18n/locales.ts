import { zh } from './locales/zh';
import { en } from './locales/en';
import { ja } from './locales/ja';
import { ko } from './locales/ko';
import { fr } from './locales/fr';
import { es } from './locales/es';

export const locales = {
  zh,
  en,
  ja,
  ko,
  fr,
  es,
} as const;

export type Language = keyof typeof locales;
export type TranslationKey = keyof typeof locales.zh;

export function formatTranslation(template: string, params?: Record<string, string | number>) {
  if (!params) return template;
  return Object.entries(params).reduce(
    (value, [key, replacement]) => value.replaceAll(`{${key}}`, String(replacement)),
    template,
  );
}
