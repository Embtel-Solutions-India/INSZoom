/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          200: '#bfdbfe',
          300: '#93c5fd',
          400: '#60a5fa',
          500: '#3b82f6',
          600: '#2563eb',
          700: '#1d4ed8',
          800: '#1e40af',
          900: '#1e3a8a',
        },
        secondary: {
          50: '#f0f9ff',
          100: '#e0f2fe',
          200: '#bae6fd',
          300: '#7dd3fc',
          400: '#38bdf8',
          500: '#0ea5e9',
          600: '#0284c7',
          700: '#0369a1',
          800: '#075985',
          900: '#0c4a6e',
        },
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
        },
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
