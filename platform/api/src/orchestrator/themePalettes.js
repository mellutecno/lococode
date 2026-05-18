// Palette concrete per ogni tema visivo.
// Ogni id in themes.js qui ha l'oggetto completo di valori Tailwind sostituibili
// nel template parametrico (`platform/templates/_base/`) durante la build.
//
// Struttura uniforme per tutti i temi cosi' il template fa solo string replace:
//   - base: "dark" | "light" — driver dell'aspetto (sfondo body, color-scheme)
//   - font: famiglie dei font (sans + display + serif opzionale + mono)
//   - ink: scala neutra (sfondi, bordi, testi spenti) — 11 step (50..950)
//   - accent: scala accento (CTA, link, focus) — 10 step (50..900)
//   - glow: tre ombre brand-aware (sm/md/lg) come stringhe CSS pronte
//   - bg: aurora gradient stops per il PageBackground
//   - selection: colore selezione testo
//   - mono: font monospace per ID/code
//
// Vale la regola "qualita' fissa, palette variabile" (memoria utente):
// la STRUTTURA dei componenti del template NON cambia mai. Solo questi
// valori cambiano per tema.

import { THEME_IDS, isValidThemeId } from "./themes.js";

const FONT_DEFAULT = {
  sans:    "'Inter', ui-sans-serif, system-ui, sans-serif",
  display: "'Inter', ui-sans-serif, system-ui, sans-serif",
  serif:   "'Instrument Serif', ui-serif, Georgia, serif",
  mono:    "'JetBrains Mono', ui-monospace, monospace",
};
const FONT_EDITORIAL = {
  sans:    "'Inter', ui-sans-serif, system-ui, sans-serif",
  display: "'Instrument Serif', ui-serif, Georgia, serif",
  serif:   "'Instrument Serif', ui-serif, Georgia, serif",
  mono:    "'JetBrains Mono', ui-monospace, monospace",
};
const FONT_NAVY = {
  sans:    "'Inter', ui-sans-serif, system-ui, sans-serif",
  display: "'Instrument Serif', ui-serif, Georgia, serif", // tocco autorevole
  serif:   "'Instrument Serif', ui-serif, Georgia, serif",
  mono:    "'JetBrains Mono', ui-monospace, monospace",
};

// Helper per generare glow CSS dato un accento (3 livelli sm/md/lg).
function glowFromHex(hex, withCard = true) {
  // hex es "#7c3aff" -> rgba(124,58,255,a)
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgba = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
  return {
    "glow-sm": `0 0 0 1px ${rgba(0.18)}, 0 4px 24px -8px ${rgba(0.35)}`,
    glow:      `0 0 0 1px ${rgba(0.25)}, 0 12px 48px -12px ${rgba(0.55)}`,
    "glow-lg": `0 0 0 1px ${rgba(0.30)}, 0 24px 80px -16px ${rgba(0.65)}`,
    ...(withCard ? {
      card:       `0 1px 0 0 rgba(255,255,255,0.04) inset, 0 8px 32px -12px rgba(0,0,0,0.6)`,
      "card-hover": `0 1px 0 0 rgba(255,255,255,0.07) inset, 0 16px 48px -12px rgba(0,0,0,0.8), 0 0 0 1px ${rgba(0.20)}`,
    } : {}),
  };
}

function lightGlowFromHex(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const rgba = (a) => `rgba(${r}, ${g}, ${b}, ${a})`;
  return {
    "glow-sm": `0 0 0 1px ${rgba(0.20)}, 0 4px 20px -6px ${rgba(0.25)}`,
    glow:      `0 0 0 1px ${rgba(0.28)}, 0 10px 40px -10px ${rgba(0.35)}`,
    "glow-lg": `0 0 0 1px ${rgba(0.32)}, 0 20px 60px -12px ${rgba(0.45)}`,
    card:       `0 1px 0 0 rgba(0,0,0,0.04) inset, 0 8px 32px -16px rgba(15,23,42,0.18)`,
    "card-hover": `0 1px 0 0 rgba(0,0,0,0.06) inset, 0 16px 48px -16px rgba(15,23,42,0.22), 0 0 0 1px ${rgba(0.18)}`,
  };
}

// =============================================================================
// PALETTES
// =============================================================================

export const THEME_PALETTES = Object.freeze({

  // ---------- dark-electric (palestra demo, Linear/Cursor vibe) ----------
  "dark-electric": {
    base: "dark",
    font: FONT_DEFAULT,
    ink: {
      50:  "#fafafd", 100: "#e6e6f0", 200: "#b8b8cf", 300: "#8a8aa3",
      400: "#5a5a72", 500: "#3b3b4d", 600: "#2a2a38", 700: "#1f1f2a",
      800: "#15151d", 900: "#0d0d13", 950: "#08080c",
    },
    accent: {
      50:  "#f3eeff", 100: "#e6dcff", 200: "#cbb6ff", 300: "#a888ff",
      400: "#8b5cff", 500: "#7c3aff", 600: "#6b25e6", 700: "#5618c2",
      800: "#41139a", 900: "#2c0d68",
    },
    glow: glowFromHex("#7c3aff"),
    bg: {
      body: "#08080c",
      aurora1: "rgba(124,58,255,0.16)",
      aurora2: "rgba(6,182,212,0.10)",
    },
    selection: "rgba(124, 58, 255, 0.35)",
  },

  // ---------- warm-amber (ristorante, food caldo italiano) ----------
  "warm-amber": {
    base: "dark",
    font: FONT_DEFAULT,
    ink: {
      50:  "#fdf9f5", 100: "#f1e6d8", 200: "#d6b894", 300: "#a88a64",
      400: "#6e5841", 500: "#4a3c2c", 600: "#382c1f", 700: "#281f15",
      800: "#1c150d", 900: "#120c06", 950: "#0a0703",
    },
    accent: {
      50:  "#fff7ec", 100: "#ffead0", 200: "#ffd29a", 300: "#ffb35d",
      400: "#ff9131", 500: "#fb7416", 600: "#ec570c", 700: "#c3410c",
      800: "#9b3411", 900: "#7d2d12",
    },
    glow: glowFromHex("#fb7416"),
    bg: {
      body: "#0a0703",
      aurora1: "rgba(251,116,22,0.15)",
      aurora2: "rgba(217,70,40,0.10)",
    },
    selection: "rgba(251, 116, 22, 0.35)",
  },

  // ---------- light-modern (negozio/e-commerce, Stripe/Notion) ----------
  "light-modern": {
    base: "light",
    font: FONT_DEFAULT,
    ink: {
      50:  "#ffffff", 100: "#f8fafc", 200: "#f1f5f9", 300: "#e2e8f0",
      400: "#cbd5e1", 500: "#94a3b8", 600: "#64748b", 700: "#475569",
      800: "#1e293b", 900: "#0f172a", 950: "#020617",
    },
    accent: {
      50:  "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc",
      400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca",
      800: "#3730a3", 900: "#312e81",
    },
    glow: lightGlowFromHex("#6366f1"),
    bg: {
      body: "#ffffff",
      aurora1: "rgba(99,102,241,0.10)",
      aurora2: "rgba(124,58,255,0.06)",
    },
    selection: "rgba(99, 102, 241, 0.20)",
  },

  // ---------- navy-trust (studio professionale, legale/finance) ----------
  "navy-trust": {
    base: "light",
    font: FONT_NAVY,
    ink: {
      50:  "#fbfaf6", 100: "#f3f0e5", 200: "#e2dcc7", 300: "#c9c1a3",
      400: "#8d8568", 500: "#5b5440", 600: "#3d3727", 700: "#2a2519",
      800: "#1c1810", 900: "#100e08", 950: "#080603",
    },
    accent: {
      50:  "#eef4ff", 100: "#dae6ff", 200: "#bccfff", 300: "#90b1ff",
      400: "#6086fa", 500: "#3b62e6", 600: "#2849c3", 700: "#1f3a9c",
      800: "#1b327d", 900: "#172a64",
    },
    glow: lightGlowFromHex("#3b62e6"),
    bg: {
      body: "#fbfaf6",
      aurora1: "rgba(59,98,230,0.10)",
      aurora2: "rgba(184,140,72,0.06)",
    },
    selection: "rgba(59, 98, 230, 0.20)",
  },

  // ---------- editorial-rose (eventi/wedding, magazine moda) ----------
  "editorial-rose": {
    base: "light",
    font: FONT_EDITORIAL,
    ink: {
      50:  "#fffaf8", 100: "#fbecea", 200: "#f1cfcb", 300: "#dba59f",
      400: "#a76d66", 500: "#73403b", 600: "#542921", 700: "#3b1a14",
      800: "#260f0a", 900: "#170804", 950: "#0c0402",
    },
    accent: {
      50:  "#fdf2f8", 100: "#fce7f3", 200: "#fbcfe8", 300: "#f9a8d4",
      400: "#f472b6", 500: "#ec4899", 600: "#db2777", 700: "#be185d",
      800: "#9d174d", 900: "#831843",
    },
    glow: lightGlowFromHex("#ec4899"),
    bg: {
      body: "#fffaf8",
      aurora1: "rgba(236,72,153,0.12)",
      aurora2: "rgba(217,119,87,0.08)",
    },
    selection: "rgba(236, 72, 153, 0.25)",
  },

  // ---------- dark-cyan (portfolio/agency, Vercel docs) ----------
  "dark-cyan": {
    base: "dark",
    font: FONT_DEFAULT,
    ink: {
      50:  "#fafafa", 100: "#e8e8ec", 200: "#b9b9c0", 300: "#8a8a90",
      400: "#5a5a5e", 500: "#36363a", 600: "#232325", 700: "#181819",
      800: "#0f0f10", 900: "#070708", 950: "#000000",
    },
    accent: {
      50:  "#ecfeff", 100: "#cffafe", 200: "#a5f3fc", 300: "#67e8f9",
      400: "#22d3ee", 500: "#06b6d4", 600: "#0891b2", 700: "#0e7490",
      800: "#155e75", 900: "#164e63",
    },
    glow: glowFromHex("#22d3ee"),
    bg: {
      body: "#000000",
      aurora1: "rgba(34,211,238,0.18)",
      aurora2: "rgba(124,58,255,0.10)",
    },
    selection: "rgba(34, 211, 238, 0.30)",
  },

  // ---------- sage-wellness (yoga/wellness, off-white natural) ----------
  "sage-wellness": {
    base: "light",
    font: FONT_DEFAULT,
    ink: {
      50:  "#fcfdf9", 100: "#f3f5ec", 200: "#dde2cb", 300: "#bfc7a3",
      400: "#7e8a64", 500: "#525a3f", 600: "#3a402b", 700: "#272c1d",
      800: "#1a1d13", 900: "#0e1009", 950: "#080a05",
    },
    accent: {
      50:  "#f4fbef", 100: "#e3f4d8", 200: "#c4e7b1", 300: "#9bd382",
      400: "#73bb5a", 500: "#52a13e", 600: "#3e7f30", 700: "#326429",
      800: "#2a5023", 900: "#23421e",
    },
    glow: lightGlowFromHex("#52a13e"),
    bg: {
      body: "#fcfdf9",
      aurora1: "rgba(82,161,62,0.10)",
      aurora2: "rgba(184,164,108,0.06)",
    },
    selection: "rgba(82, 161, 62, 0.20)",
  },
});

// Sanity check: ogni id in THEME_IDS deve avere una palette qui.
for (const id of THEME_IDS) {
  if (!THEME_PALETTES[id]) {
    throw new Error(`themePalettes.js: manca palette per tema "${id}".`);
  }
}

// API pubblica
export function themePalette(id) {
  if (!isValidThemeId(id)) return null;
  return THEME_PALETTES[id] || null;
}

export function themePaletteWithFallback(id, fallbackId = "dark-electric") {
  return themePalette(id) || themePalette(fallbackId);
}

// Serializza la palette in oggetto piatto stringa->stringa adatto al
// token-replace nel template (es. "{{THEME_INK_950}}" -> "#08080c").
// Naming: maiuscolo + snake con prefisso THEME_ per non collidere.
export function themeReplaceMap(id) {
  const p = themePaletteWithFallback(id);
  if (!p) return {};
  const map = {
    THEME_BASE: p.base,
    THEME_FONT_SANS: p.font.sans,
    THEME_FONT_DISPLAY: p.font.display,
    THEME_FONT_SERIF: p.font.serif,
    THEME_FONT_MONO: p.font.mono,
    THEME_BG_BODY: p.bg.body,
    THEME_BG_AURORA1: p.bg.aurora1,
    THEME_BG_AURORA2: p.bg.aurora2,
    THEME_SELECTION: p.selection,
    THEME_GLOW_SM: p.glow["glow-sm"],
    THEME_GLOW:    p.glow["glow"],
    THEME_GLOW_LG: p.glow["glow-lg"],
    THEME_GLOW_CARD: p.glow["card"],
    THEME_GLOW_CARD_HOVER: p.glow["card-hover"],
  };
  for (const [step, hex] of Object.entries(p.ink)) {
    map[`THEME_INK_${step}`] = hex;
  }
  for (const [step, hex] of Object.entries(p.accent)) {
    map[`THEME_ACCENT_${step}`] = hex;
  }
  return map;
}
