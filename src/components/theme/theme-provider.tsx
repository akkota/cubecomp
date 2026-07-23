'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import {
  applyThemeToDocument,
  DEFAULT_THEME_ID,
  LEGACY_THEME_STORAGE_KEY,
  resolveStoredThemeId,
  THEME_BY_ID,
  THEME_STORAGE_KEY,
  type ThemeId,
} from '@/lib/themes';

type ThemeContextValue = {
  themeId: ThemeId;
  isDark: boolean;
  setTheme: (id: ThemeId) => void;
};

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readInitialTheme(): ThemeId {
  if (typeof window === 'undefined') return DEFAULT_THEME_ID;
  const stored =
    localStorage.getItem(THEME_STORAGE_KEY) ??
    localStorage.getItem(LEGACY_THEME_STORAGE_KEY);
  return resolveStoredThemeId(stored);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeId, setThemeId] = useState<ThemeId>(DEFAULT_THEME_ID);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    const id = readInitialTheme();
    setThemeId(id);
    applyThemeToDocument(id);
    setMounted(true);
  }, []);

  const setTheme = useCallback((id: ThemeId) => {
    setThemeId(id);
    applyThemeToDocument(id);
    try {
      localStorage.setItem(THEME_STORAGE_KEY, id);
      // Clear legacy key so it doesn't fight migration
      localStorage.removeItem(LEGACY_THEME_STORAGE_KEY);
    } catch {
      /* ignore quota / private mode */
    }
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeId: mounted ? themeId : DEFAULT_THEME_ID,
      isDark: THEME_BY_ID[mounted ? themeId : DEFAULT_THEME_ID].isDark,
      setTheme,
    }),
    [mounted, themeId, setTheme],
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used within ThemeProvider');
  }
  return ctx;
}
