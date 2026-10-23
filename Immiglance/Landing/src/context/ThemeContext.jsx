import { createContext, useContext, useEffect } from 'react';

const ThemeContext = createContext(undefined);

// The Landing site is always light: a white background with black and grey only. The visitor's stored choice, the
// account's saved theme and the OS preference are all ignored here, and the toggle is hidden (see ThemeToggle).
const NOOP = () => {};
const VALUE = { theme: 'light', setTheme: NOOP, toggleTheme: NOOP, applyServerTheme: NOOP, registerPersist: NOOP };

export function ThemeProvider({ children }) {
  useEffect(() => {
    document.documentElement.classList.remove('dark');
  }, []);

  return <ThemeContext.Provider value={VALUE}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within a ThemeProvider');
  return ctx;
}
