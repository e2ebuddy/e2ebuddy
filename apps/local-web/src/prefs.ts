import type { Locale } from './i18n';

export type Theme = 'dark' | 'light';

const LOCALE_KEY = 'e2ebuddy.locale';
const THEME_KEY = 'e2ebuddy.theme';

export function loadLocale(): Locale {
  const raw = localStorage.getItem(LOCALE_KEY);
  return raw === 'en' ? 'en' : 'zh';
}

export function saveLocale(locale: Locale): void {
  localStorage.setItem(LOCALE_KEY, locale);
  document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en';
}

export function loadTheme(): Theme {
  const raw = localStorage.getItem(THEME_KEY);
  if (raw === 'light' || raw === 'dark') return raw;
  if (window.matchMedia?.('(prefers-color-scheme: light)').matches) return 'light';
  return 'dark';
}

export function applyTheme(theme: Theme): void {
  localStorage.setItem(THEME_KEY, theme);
  const root = document.documentElement;
  root.classList.remove('light', 'dark');
  root.classList.add(theme);
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
}

export function initPrefs(): { locale: Locale; theme: Theme } {
  const locale = loadLocale();
  const theme = loadTheme();
  saveLocale(locale);
  applyTheme(theme);
  return { locale, theme };
}
