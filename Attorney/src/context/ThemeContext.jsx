import { createContext, useContext, useEffect, useRef, useState } from 'react'

const ThemeContext = createContext(null)

const STORAGE_KEY = 'attorney-theme'

function getInitialTheme() {
  try {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // localStorage unavailable (private mode, etc.) - fall through to default
  }
  return 'light'
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(getInitialTheme)
  const persistRef = useRef(null) // set by ThemeSync while signed in: saves the choice on the user's account

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    try {
      localStorage.setItem(STORAGE_KEY, theme)
    } catch {
      // ignore - persistence is a convenience, not a requirement
    }
  }, [theme])

  const toggleTheme = () => {
    const next = theme === 'dark' ? 'light' : 'dark'
    setTheme(next)
    persistRef.current?.(next)
  }
  // The account's saved theme wins over this browser's: applied on sign-in, never written back.
  const applyServerTheme = (next) => setTheme((current) => (current === next ? current : next))
  const registerPersist = (fn) => { persistRef.current = fn }

  return (
    <ThemeContext.Provider value={{ theme, isDark: theme === 'dark', toggleTheme, applyServerTheme, registerPersist }}>
      {children}
    </ThemeContext.Provider>
  )
}

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) throw new Error('useTheme must be used within a ThemeProvider')
  return context
}
