/** @type {import('tailwindcss').Config} */
// Config parametrico - palette dal tema scelto dall'orchestrator.
// I valori "__THEME_*__" vengono sostituiti dal frontendBuilder al build time.
export default {
  darkMode: "class",
  content: ["./index.html", "./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      fontFamily: {
        sans:    ["__THEME_FONT_SANS__"],
        display: ["__THEME_FONT_DISPLAY__"],
        serif:   ["__THEME_FONT_SERIF__"],
        mono:    ["__THEME_FONT_MONO__"],
      },
      colors: {
        ink: {
          50:  "__THEME_INK_50__",
          100: "__THEME_INK_100__",
          200: "__THEME_INK_200__",
          300: "__THEME_INK_300__",
          400: "__THEME_INK_400__",
          500: "__THEME_INK_500__",
          600: "__THEME_INK_600__",
          700: "__THEME_INK_700__",
          800: "__THEME_INK_800__",
          900: "__THEME_INK_900__",
          950: "__THEME_INK_950__",
        },
        accent: {
          50:  "__THEME_ACCENT_50__",
          100: "__THEME_ACCENT_100__",
          200: "__THEME_ACCENT_200__",
          300: "__THEME_ACCENT_300__",
          400: "__THEME_ACCENT_400__",
          500: "__THEME_ACCENT_500__",
          600: "__THEME_ACCENT_600__",
          700: "__THEME_ACCENT_700__",
          800: "__THEME_ACCENT_800__",
          900: "__THEME_ACCENT_900__",
        },
      },
      letterSpacing: {
        tightish: "-0.015em",
        tighter2: "-0.035em",
      },
      boxShadow: {
        "glow-sm":    "__THEME_GLOW_SM__",
        "glow":       "__THEME_GLOW__",
        "glow-lg":    "__THEME_GLOW_LG__",
        "card":       "__THEME_GLOW_CARD__",
        "card-hover": "__THEME_GLOW_CARD_HOVER__",
      },
      animation: {
        "fade-in":    "fadeIn 320ms ease-out both",
        "rise":       "rise 420ms cubic-bezier(.21,.92,.34,1) both",
        "rise-slow":  "rise 720ms cubic-bezier(.21,.92,.34,1) both",
        "shimmer":    "shimmer 2.2s linear infinite",
        "aurora":     "aurora 14s ease-in-out infinite",
        "scale-in":   "scaleIn 220ms cubic-bezier(.21,.92,.34,1) both",
      },
      keyframes: {
        fadeIn:    { "0%": { opacity: "0" }, "100%": { opacity: "1" } },
        rise:      { "0%": { opacity: "0", transform: "translateY(8px)" },
                     "100%": { opacity: "1", transform: "translateY(0)" } },
        scaleIn:   { "0%": { opacity: "0", transform: "scale(0.96)" },
                     "100%": { opacity: "1", transform: "scale(1)" } },
        shimmer:   { "0%": { backgroundPosition: "-200% 0" },
                     "100%": { backgroundPosition: "200% 0" } },
        aurora:    { "0%, 100%": { transform: "translate3d(0,0,0) scale(1)", opacity: "0.55" },
                     "50%":      { transform: "translate3d(2%,-1%,0) scale(1.08)", opacity: "0.8" } },
      },
      backgroundImage: {
        "grid-dim": "radial-gradient(circle at 1px 1px, rgba(255,255,255,0.05) 1px, transparent 0)",
        "aurora-1": "radial-gradient(60% 60% at 30% 30%, __THEME_BG_AURORA1__, transparent 70%)",
        "aurora-2": "radial-gradient(60% 60% at 80% 70%, __THEME_BG_AURORA2__, transparent 70%)",
      },
    },
  },
  plugins: [],
};
