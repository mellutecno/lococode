/** @type {import('tailwindcss').Config} */
// Palette MelluCode Console: pure black + cyan electric (vibe Vercel/Cursor).
// Stessa STRUTTURA del template palestra (ink.* + accent.*) ma colori diversi —
// e' la prova che il design system e' palette-agnostic.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans:    ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        display: ['Inter', 'ui-sans-serif', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'ui-monospace', 'monospace'],
      },
      colors: {
        ink: {
          950: '#000000',
          900: '#070708',
          800: '#0f0f10',
          700: '#181819',
          600: '#232325',
          500: '#36363a',
          400: '#5a5a5e',
          300: '#8a8a90',
          200: '#b9b9c0',
          100: '#e8e8ec',
        },
        // Cyan electric, vibe dev tool / platform.
        accent: {
          50:  '#ecfeff',
          100: '#cffafe',
          200: '#a5f3fc',
          300: '#67e8f9',
          400: '#22d3ee', // bright
          500: '#06b6d4', // primary
          600: '#0891b2',
          700: '#0e7490',
          800: '#155e75',
          900: '#164e63',
        },
      },
      letterSpacing: {
        tightish: '-0.015em',
        tighter2: '-0.035em',
      },
      boxShadow: {
        'glow-sm': '0 0 0 1px rgba(34, 211, 238, 0.16), 0 4px 24px -8px rgba(34, 211, 238, 0.35)',
        'glow':    '0 0 0 1px rgba(34, 211, 238, 0.22), 0 12px 48px -12px rgba(34, 211, 238, 0.55)',
        'glow-lg': '0 0 0 1px rgba(34, 211, 238, 0.28), 0 24px 80px -16px rgba(34, 211, 238, 0.65)',
        'card':    '0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 32px -12px rgba(0,0,0,0.7)',
        'card-hover': '0 1px 0 0 rgba(255,255,255,0.07) inset, 0 16px 48px -12px rgba(0,0,0,0.9), 0 0 0 1px rgba(34,211,238,0.20)',
      },
      animation: {
        'fade-in':    'fadeIn 320ms ease-out both',
        'rise':       'rise 420ms cubic-bezier(.21,.92,.34,1) both',
        'rise-slow':  'rise 720ms cubic-bezier(.21,.92,.34,1) both',
        'shimmer':    'shimmer 2.2s linear infinite',
        'aurora':     'aurora 16s ease-in-out infinite',
        'pulse-glow': 'pulseGlow 2.4s ease-in-out infinite',
        'scale-in':   'scaleIn 220ms cubic-bezier(.21,.92,.34,1) both',
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
        scaleIn: {
          '0%': { opacity: '0', transform: 'scale(0.96)' },
          '100%': { opacity: '1', transform: 'scale(1)' },
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
          '0%, 100%': { boxShadow: '0 0 0 0 rgba(34,211,238,0.40)' },
          '50%':      { boxShadow: '0 0 0 10px rgba(34,211,238,0)' },
        },
      },
      backgroundImage: {
        'grid-dim': "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)",
        'aurora-1': "radial-gradient(60% 60% at 30% 30%, rgba(34,211,238,0.40), transparent 70%)",
        'aurora-2': "radial-gradient(60% 60% at 80% 70%, rgba(124,58,255,0.18), transparent 70%)",
      },
    },
  },
  plugins: [],
};
