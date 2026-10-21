import { en } from './en';
import { tr } from './tr';

export type MessageKey = keyof typeof tr;
export type Locale = 'tr' | 'en';
export const LOCALES: readonly Locale[] = ['tr', 'en'];
export type Params = Record<string, string | number>;
export type Translate = (key: MessageKey, params?: Params) => string;

export const dictionaries: Record<Locale, Record<MessageKey, string>> = { tr, en };

export const hasKey = (key: string): key is MessageKey => Object.hasOwn(tr, key);

/** Fills `{name}` placeholders; a placeholder with no value is left visible so a missing value shows up in testing. */
export function fill(template: string, params: Params = {}): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (Object.hasOwn(params, name) ? String(params[name]) : whole));
}

export function translate(locale: Locale, key: MessageKey, params?: Params): string {
  return fill(dictionaries[locale][key] ?? dictionaries.en[key] ?? key, params);
}

export const isLocale = (x: unknown): x is Locale => x === 'tr' || x === 'en';

/** The saved choice if there is one, else the first browser language we speak, else English. */
export function detectLocale(languages: readonly string[] | undefined, saved: string | null): Locale {
  if (isLocale(saved)) return saved;
  for (const l of languages ?? []) {
    const base = l.toLowerCase().split('-')[0];
    if (isLocale(base)) return base;
  }
  return 'en';
}
