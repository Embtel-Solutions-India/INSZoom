import { createContext, useContext, useEffect, useState } from 'react';

const ThemeContext = createContext(undefined);

// Same key as the Client app, so a visitor's choice follows them across the two origins' own storage
// (each origin still keeps its own copy). Defaults to light; dark is opt-in via the ThemeToggle.
const STORAGE_KEY = 'immiglance-theme';

function getInitialTheme() {
  try {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    if (stored === 'light' || stored === 'dark') return stored;
  } catch { /* storage blocked */ }
  return 'light';
}

// Landing is anonymous, so there is no account theme to sync — the sync hooks are kept as no-ops so the
// context shape matches Client's.
const NOOP = () => {};

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    try { window.localStorage.setItem(STORAGE_KEY, theme); } catch { /* storage blocked */ }
  }, [theme]);

  const toggleTheme = () => setTheme((current) => (current === 'dark' ? 'light' : 'dark'));

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, applyServerTheme: NOOP, registerPersist: NOOP }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
