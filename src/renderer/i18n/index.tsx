import { createContext, useCallback, useContext, useMemo, type ReactNode } from 'react';
import { en, type TranslationKey } from './en';
import { el } from './el';

/**
 * Translation.
 *
 * Small on purpose — the app needs interpolation and a fallback chain, and
 * nothing else. Greek is a partial dictionary that falls back to English per
 * key, so a missing translation degrades to readable English instead of a raw
 * key appearing in the interface.
 */

export type Language = 'en' | 'el';

const DICTIONARIES: Record<Language, Partial<Record<TranslationKey, string>>> = { en, el };

export type TranslationValues = Record<string, string | number>;

function interpolate(template: string, values?: TranslationValues): string {
  if (!values) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : String(value);
  });
}

export function translate(
  language: Language,
  key: TranslationKey | string,
  values?: TranslationValues,
): string {
  const dictionary = DICTIONARIES[language] ?? en;
  const template =
    dictionary[key as TranslationKey] ?? en[key as TranslationKey] ?? (key as string);
  return interpolate(template, values);
}

interface I18nContextValue {
  language: Language;
  t: (key: TranslationKey | string, values?: TranslationValues) => string;
  /** Locale-aware number/date formatting shares the language choice. */
  locale: string;
}

const I18nContext = createContext<I18nContextValue>({
  language: 'en',
  t: (key, values) => translate('en', key, values),
  locale: 'en-GB',
});

const LOCALES: Record<Language, string> = { en: 'en-GB', el: 'el-GR' };

export function I18nProvider({
  language,
  children,
}: {
  language: Language;
  children: ReactNode;
}): JSX.Element {
  const t = useCallback(
    (key: TranslationKey | string, values?: TranslationValues) => translate(language, key, values),
    [language],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ language, t, locale: LOCALES[language] ?? 'en-GB' }),
    [language, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

/** Convenience hook for the common case of only needing `t`. */
export function useT(): I18nContextValue['t'] {
  return useContext(I18nContext).t;
}

export type { TranslationKey };
