/** @type {import('tailwindcss').Config} */
export default {
  darkMode: 'class',
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
          border: 'hsl(var(--card-border))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        secondary: {
          DEFAULT: 'hsl(var(--secondary))',
          foreground: 'hsl(var(--secondary-foreground))',
          50: 'hsl(var(--secondary))',
          100: 'hsl(var(--secondary))',
          200: 'hsl(var(--secondary))',
          300: 'hsl(var(--muted-foreground))',
          400: 'hsl(var(--muted-foreground))',
          500: 'hsl(var(--muted-foreground))',
          600: 'hsl(var(--secondary-foreground))',
          700: 'hsl(var(--secondary-foreground))',
          800: 'hsl(var(--secondary-foreground))',
          900: 'hsl(var(--foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        sidebar: {
          DEFAULT: 'hsl(var(--sidebar))',
          foreground: 'hsl(var(--sidebar-foreground))',
          border: 'hsl(var(--sidebar-border))',
          primary: 'hsl(var(--sidebar-primary))',
          'primary-foreground': 'hsl(var(--sidebar-primary-foreground))',
          accent: 'hsl(var(--sidebar-accent))',
          'accent-foreground': 'hsl(var(--sidebar-accent-foreground))',
          ring: 'hsl(var(--sidebar-ring))',
        },
        chart: {
          1: 'hsl(var(--chart-1))',
          2: 'hsl(var(--chart-2))',
          3: 'hsl(var(--chart-3))',
          4: 'hsl(var(--chart-4))',
          5: 'hsl(var(--chart-5))',
        },
        // PRESERVE the existing `primary` key — every className that already
        // reads `bg-primary-600`, `text-primary-700`, etc. keeps resolving,
        // now to the Immiglance navy/blue token instead of the old hex scale.
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
          50: 'hsl(var(--primary) / 0.08)',
          100: 'hsl(var(--primary) / 0.16)',
          200: 'hsl(var(--primary) / 0.24)',
          300: 'hsl(var(--primary) / 0.4)',
          400: 'hsl(var(--primary) / 0.7)',
          500: 'hsl(var(--primary))',
          600: 'hsl(var(--primary))',
          700: 'hsl(var(--primary))',
          800: 'hsl(var(--primary))',
          900: 'hsl(var(--foreground))',
        },
        // Existing sidebar-logo/dark-surface scale — kept as a real key
        // (unchanged) since navy-50..900 literal shades are still used
        // directly (e.g. `bg-navy-800`) in places Phase 4 hasn't swept yet;
        // never delete this key, only stop introducing new usages of it.
        navy: {
          50: '#f5f6f8',
          100: '#e8eaee',
          200: '#c7cbd6',
          300: '#9aa1b4',
          400: '#646c85',
          500: '#3f4761',
          600: '#2c3348',
          700: '#212636',
          800: '#171a26',
          900: '#0f111a',
          950: '#090a10',
        },
      },
      fontFamily: {
        sans: ['Satoshi', 'Inter', 'sans-serif'],
        serif: ['Cabinet Grotesk', 'Satoshi', 'sans-serif'],
        mono: ['JetBrains Mono', 'Menlo', 'monospace'],
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      // No custom fontSize override — stock Tailwind scale (text-sm = 14px at
      // the 16px root above), matching BAIS's client portal exactly (it has
      // no override either). The previous override shrank every size below
      // stock on top of a shrunk 14px root, compounding into a genuinely
      // too-small admin portal.
    },
  },
  plugins: [],
}
