import { createContext, useContext, useEffect, useRef, useState } from 'react';

const ThemeContext = createContext(undefined);

const STORAGE_KEY = 'immiglance-theme';

// Always defaults to light regardless of the visitor's OS/browser dark-mode
// preference — matches Admin's and Attorney's ThemeContext, which never
// auto-detected system preference to begin with. Dark mode is opt-in only,
// via the ThemeToggle button; once toggled, the explicit choice is what
// persists here on the next visit, never a system-preference guess.
function getInitialTheme() {
  if (typeof window === 'undefined') return 'light';
  const stored = window.localStorage.getItem(STORAGE_KEY);
  if (stored === 'light' || stored === 'dark') return stored;
  return 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);
  const persistRef = useRef(null); // set by ThemeSync while signed in: saves the choice on the user's account

  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle('dark', theme === 'dark');
    window.localStorage.setItem(STORAGE_KEY, theme);
  }, [theme]);

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    persistRef.current?.(next);
  };
  // The account's saved theme wins over this browser's: applied on sign-in, never written back.
  const applyServerTheme = (next) => setTheme((current) => (current === next ? current : next));
  const registerPersist = (fn) => { persistRef.current = fn; };

  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme, applyServerTheme, registerPersist }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
