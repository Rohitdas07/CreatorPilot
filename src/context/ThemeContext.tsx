import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';

export type ThemeMode = 'light' | 'dark' | 'system';
export type ResolvedTheme = 'light' | 'dark';

const GLOBAL_THEME_KEY = 'creatorpilot_theme_mode';

function isValidThemeMode(value: string | null): value is ThemeMode {
  return value === 'light' || value === 'dark' || value === 'system';
}

function getSystemTheme(): ResolvedTheme {
  if (typeof window === 'undefined' || !window.matchMedia) return 'dark';
  return window.matchMedia('(prefers-color-scheme: dark)').matches
    ? 'dark'
    : 'light';
}

function resolveTheme(mode: ThemeMode): ResolvedTheme {
  if (mode === 'system') return getSystemTheme();
  return mode;
}

function applyThemeToDocument(resolved: ResolvedTheme) {
  if (typeof document === 'undefined') return;
  const root = document.documentElement;
  root.classList.toggle('dark', resolved === 'dark');
  root.style.colorScheme = resolved;
  root.dataset.theme = resolved;
}

function readInitialThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  try {
    const stored = window.localStorage.getItem(GLOBAL_THEME_KEY);
    if (isValidThemeMode(stored)) return stored;
  } catch {
    // Ignore storage read errors
  }
  return 'system';
}

interface ThemeContextValue {
  themeMode: ThemeMode;
  resolvedTheme: ResolvedTheme;
  setThemeMode: (mode: ThemeMode) => void;
  toggleTheme: () => void;
  syncUserTheme: (uid: string | null) => void;
}

const ThemeContext = createContext<ThemeContextValue | undefined>(undefined);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [themeMode, setThemeModeState] = useState<ThemeMode>(readInitialThemeMode);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() =>
    resolveTheme(readInitialThemeMode())
  );
  const [activeUid, setActiveUid] = useState<string | null>(null);

  const persistTheme = useCallback(
    (mode: ThemeMode, uid: string | null) => {
      try {
        window.localStorage.setItem(GLOBAL_THEME_KEY, mode);
        if (uid) {
          window.localStorage.setItem(`${GLOBAL_THEME_KEY}:${uid}`, mode);
        }
      } catch {
        // Ignore storage errors
      }
    },
    []
  );

  const setThemeMode = useCallback(
    (mode: ThemeMode) => {
      setThemeModeState(mode);
      const nextResolved = resolveTheme(mode);
      setResolvedTheme(nextResolved);
      applyThemeToDocument(nextResolved);
      persistTheme(mode, activeUid);
    },
    [activeUid, persistTheme]
  );

  const toggleTheme = useCallback(() => {
    const nextMode: ThemeMode = resolvedTheme === 'dark' ? 'light' : 'dark';
    setThemeMode(nextMode);
  }, [resolvedTheme, setThemeMode]);

  const syncUserTheme = useCallback((uid: string | null) => {
    setActiveUid(uid);
    if (!uid) return;
    try {
      const userStored = window.localStorage.getItem(`${GLOBAL_THEME_KEY}:${uid}`);
      if (isValidThemeMode(userStored)) {
        setThemeModeState(userStored);
        const nextResolved = resolveTheme(userStored);
        setResolvedTheme(nextResolved);
        applyThemeToDocument(nextResolved);
        window.localStorage.setItem(GLOBAL_THEME_KEY, userStored);
      } else {
        const currentGlobal = window.localStorage.getItem(GLOBAL_THEME_KEY);
        if (isValidThemeMode(currentGlobal)) {
          window.localStorage.setItem(`${GLOBAL_THEME_KEY}:${uid}`, currentGlobal);
        }
      }
    } catch {
      // Ignore storage errors
    }
  }, []);

  // Apply on mount and listen to OS preference changes when in 'system' mode
  useEffect(() => {
    const currentResolved = resolveTheme(themeMode);
    setResolvedTheme(currentResolved);
    applyThemeToDocument(currentResolved);

    if (themeMode !== 'system' || !window.matchMedia) return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handleMediaChange = (event: MediaQueryListEvent) => {
      const next: ResolvedTheme = event.matches ? 'dark' : 'light';
      setResolvedTheme(next);
      applyThemeToDocument(next);
    };

    mediaQuery.addEventListener('change', handleMediaChange);
    return () => mediaQuery.removeEventListener('change', handleMediaChange);
  }, [themeMode]);

  // Keep multiple open tabs synchronized
  useEffect(() => {
    const onStorage = (event: StorageEvent) => {
      if (event.key === GLOBAL_THEME_KEY && isValidThemeMode(event.newValue)) {
        setThemeModeState(event.newValue);
        const nextResolved = resolveTheme(event.newValue);
        setResolvedTheme(nextResolved);
        applyThemeToDocument(nextResolved);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const value = useMemo<ThemeContextValue>(
    () => ({
      themeMode,
      resolvedTheme,
      setThemeMode,
      toggleTheme,
      syncUserTheme,
    }),
    [themeMode, resolvedTheme, setThemeMode, toggleTheme, syncUserTheme]
  );

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  if (!ctx) {
    throw new Error('useTheme must be used inside a ThemeProvider.');
  }
  return ctx;
}
