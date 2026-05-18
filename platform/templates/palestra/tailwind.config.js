/** @type {import('tailwindcss').Config} */
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        serif: ['"Instrument Serif"', 'ui-serif', 'Georgia', 'serif'],
        mono: ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        // Background scale: app sta su uno zinc-950 leggermente desaturato verso il violetto.
        ink: {
          950: '#08080c',
          900: '#0d0d13',
          800: '#15151d',
          700: '#1f1f2a',
          600: '#2a2a38',
          500: '#3b3b4d',
          400: '#5a5a72',
          300: '#8a8aa3',
          200: '#b8b8cf',
          100: '#e6e6f0',
        },
        // Accento elettrico, vibe Linear/Cursor.
        accent: {
          50:  '#f3eeff',
          100: '#e6dcff',
          200: '#cbb6ff',
          300: '#a888ff',
          400: '#8b5cff',
          500: '#7c3aff', // primary
          600: '#6b25e6',
          700: '#5618c2',
          800: '#41139a',
          900: '#2c0d68',
        },
      },
      letterSpacing: {
        tightish: '-0.015em',
        tighter2: '-0.035em',
      },
      boxShadow: {
        'glow-sm': '0 0 0 1px rgba(124, 58, 255, 0.18), 0 4px 24px -8px rgba(124, 58, 255, 0.35)',
        'glow':    '0 0 0 1px rgba(124, 58, 255, 0.25), 0 12px 48px -12px rgba(124, 58, 255, 0.55)',
        'glow-lg': '0 0 0 1px rgba(124, 58, 255, 0.30), 0 24px 80px -16px rgba(124, 58, 255, 0.65)',
        'card':    '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 32px -12px rgba(0,0,0,0.6)',
        'card-hover': '0 1px 0 0 rgba(255,255,255,0.07) inset, 0 16px 48px -12px rgba(0,0,0,0.8), 0 0 0 1px rgba(124,58,255,0.20)',
      },
      animation: {
        'fade-in':       'fadeIn 320ms ease-out both',
        'rise':          'rise 420ms cubic-bezier(.21,.92,.34,1) both',
        'rise-slow':     'rise 720ms cubic-bezier(.21,.92,.34,1) both',
        'shimmer':       'shimmer 2.2s linear infinite',
        'aurora':        'aurora 14s ease-in-out infinite',
        'pulse-glow':    'pulseGlow 2.4s ease-in-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        rise: {
          '0%': { opacity: '0', transform: 'translateY(8px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
        shimmer: {
          '0%':   { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
        aurora: {
          '0%, 100%': { transform: 'translate3d(0,0,0) scale(1)', opacity: '0.55' },
          '50%':      { transform: 'translate3d(2%,-1%,0) scale(1.08)', opacity: '0.8' },
        },
        pulseGlow: {
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(124,58,255,0.45)' },
          '50%':      { boxShadow: '0 0 0 10px rgba(124,58,255,0)' },
        },
      },
      backgroundImage: {
        'grid-dim': "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)",
        'aurora-1': "radial-gradient(60% 60% at 30% 30%, rgba(124,58,255,0.45), transparent 70%)",
        'aurora-2': "radial-gradient(60% 60% at 80% 70%, rgba(6,182,212,0.30), transparent 70%)",
      },
    },
  },
  plugins: [],
};
