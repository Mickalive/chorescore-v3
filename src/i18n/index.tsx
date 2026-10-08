/**
 * ChoreScore V4 — i18n runtime.
 *
 * Lightweight provider: default FR, persisted preference, `{name}`
 * interpolation. Kept intentionally dependency-free (AsyncStorage only) so it
 * can be used from any screen without coupling to the domain.
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import {
  DEFAULT_LOCALE,
  SupportedLocale,
  SUPPORTED_LOCALES,
  resolveString,
} from './catalog';

export {
  CATALOG,
  DEFAULT_LOCALE,
  SUPPORTED_LOCALES,
  resolveString,
  unitShortLabel,
} from './catalog';
export type { SupportedLocale, LocaleCatalog } from './catalog';

const STORAGE_KEY = 'chorescore.locale.v4';

export type TranslateParams = Record<string, string | number>;
export type Translate = (key: string, params?: TranslateParams) => string;

export interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (locale: SupportedLocale) => void;
  t: Translate;
}

function isSupportedLocale(value: unknown): value is SupportedLocale {
  return typeof value === 'string' && (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

const I18nContext = createContext<I18nContextValue | null>(null);

export interface I18nProviderProps {
  children: React.ReactNode;
  /** Deterministic override (tests / E2E). When absent, FR is used. */
  initialLocale?: SupportedLocale;
}

export function I18nProvider({ children, initialLocale }: I18nProviderProps) {
  const [locale, setLocaleState] = useState<SupportedLocale>(initialLocale ?? DEFAULT_LOCALE);

  useEffect(() => {
    if (initialLocale) return;
    let cancelled = false;
    AsyncStorage.getItem(STORAGE_KEY)
      .then((stored) => {
        if (!cancelled && isSupportedLocale(stored) && stored !== locale) {
          setLocaleState(stored);
        }
      })
      .catch(() => {
        // Preference is best-effort; FR remains the fallback.
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLocale]);

  const setLocale = useCallback((next: SupportedLocale) => {
    setLocaleState(next);
    AsyncStorage.setItem(STORAGE_KEY, next).catch(() => {
      // Ignore persistence failures; the in-memory locale still applies.
    });
  }, []);

  const t = useCallback<Translate>(
    (key, params) => resolveString(locale, key, params),
    [locale],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t }),
    [locale, setLocale, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) {
    throw new Error('useI18n must be used within an I18nProvider');
  }
  return context;
}
