import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { THEME_PALETTES, themePalette, themePaletteWithFallback, themeReplaceMap } from "./themePalettes.js";
import { THEME_IDS } from "./themes.js";

describe("THEME_PALETTES coverage", () => {
  test("ogni tema in THEME_IDS ha una palette completa", () => {
    for (const id of THEME_IDS) {
      const p = THEME_PALETTES[id];
      assert.ok(p, `palette mancante per ${id}`);
      assert.ok(p.base === "dark" || p.base === "light", `${id}: base invalido`);
      assert.ok(p.font?.sans, `${id}: font.sans mancante`);
      assert.ok(p.font?.display, `${id}: font.display mancante`);
      assert.ok(p.font?.mono, `${id}: font.mono mancante`);
      assert.ok(p.bg?.body, `${id}: bg.body mancante`);
      assert.ok(p.selection, `${id}: selection mancante`);
    }
  });

  test("ogni palette ha ink scala 50..950 (11 step) e accent 50..900 (10 step)", () => {
    const inkSteps = ["50","100","200","300","400","500","600","700","800","900","950"];
    const accentSteps = ["50","100","200","300","400","500","600","700","800","900"];
    for (const id of THEME_IDS) {
      const p = THEME_PALETTES[id];
      for (const s of inkSteps)    assert.ok(p.ink[s],    `${id}: ink.${s} mancante`);
      for (const s of accentSteps) assert.ok(p.accent[s], `${id}: accent.${s} mancante`);
    }
  });

  test("ogni palette ha shadow glow sm/md/lg + card + card-hover", () => {
    for (const id of THEME_IDS) {
      const g = THEME_PALETTES[id].glow;
      assert.ok(g["glow-sm"], `${id}: glow-sm mancante`);
      assert.ok(g["glow"],    `${id}: glow mancante`);
      assert.ok(g["glow-lg"], `${id}: glow-lg mancante`);
      assert.ok(g["card"],    `${id}: card shadow mancante`);
      assert.ok(g["card-hover"], `${id}: card-hover mancante`);
    }
  });

  test("ink e accent sono stringhe hex valide", () => {
    const hexRe = /^#[0-9a-fA-F]{6}$/;
    for (const id of THEME_IDS) {
      const p = THEME_PALETTES[id];
      for (const [step, hex] of Object.entries(p.ink)) {
        assert.match(hex, hexRe, `${id}: ink.${step} non hex: ${hex}`);
      }
      for (const [step, hex] of Object.entries(p.accent)) {
        assert.match(hex, hexRe, `${id}: accent.${step} non hex: ${hex}`);
      }
    }
  });
});

describe("themePalette / themePaletteWithFallback", () => {
  test("themePalette ritorna palette per id valido", () => {
    const p = themePalette("dark-electric");
    assert.ok(p);
    assert.equal(p.base, "dark");
    assert.equal(p.accent[500], "#7c3aff");
  });

  test("themePalette ritorna null per id invalido", () => {
    assert.equal(themePalette("non-esiste"), null);
    assert.equal(themePalette(""), null);
    assert.equal(themePalette(null), null);
  });

  test("themePaletteWithFallback usa dark-electric come default", () => {
    const p = themePaletteWithFallback("non-esiste");
    assert.ok(p);
    assert.equal(p.accent[500], "#7c3aff");
  });

  test("themePaletteWithFallback rispetta override fallback", () => {
    const p = themePaletteWithFallback("non-esiste", "warm-amber");
    assert.equal(p.accent[500], "#fb7416");
  });
});

describe("themeReplaceMap (token replace for template)", () => {
  test("mappa tutti i token necessari per dark-electric", () => {
    const m = themeReplaceMap("dark-electric");
    assert.equal(m.THEME_BASE, "dark");
    assert.equal(m.THEME_INK_950, "#08080c");
    assert.equal(m.THEME_ACCENT_500, "#7c3aff");
    assert.equal(m.THEME_INK_100, "#e6e6f0");
    assert.equal(m.THEME_ACCENT_50, "#f3eeff");
    assert.ok(m.THEME_GLOW_SM);
    assert.ok(m.THEME_GLOW);
    assert.ok(m.THEME_GLOW_LG);
    assert.ok(m.THEME_BG_BODY);
    assert.ok(m.THEME_FONT_SANS);
  });

  test("mappa rispetta tema warm-amber", () => {
    const m = themeReplaceMap("warm-amber");
    assert.equal(m.THEME_BASE, "dark");
    assert.equal(m.THEME_ACCENT_500, "#fb7416");
    assert.equal(m.THEME_INK_950, "#0a0703");
  });

  test("light theme produce base=light", () => {
    const m = themeReplaceMap("light-modern");
    assert.equal(m.THEME_BASE, "light");
    assert.equal(m.THEME_ACCENT_500, "#6366f1");
  });

  test("invalido fallback su dark-electric", () => {
    const m = themeReplaceMap("alieno");
    assert.equal(m.THEME_BASE, "dark");
    assert.equal(m.THEME_ACCENT_500, "#7c3aff");
  });

  test("ogni token mappa e' stringa non vuota", () => {
    for (const id of THEME_IDS) {
      const m = themeReplaceMap(id);
      for (const [k, v] of Object.entries(m)) {
        assert.equal(typeof v, "string", `${id}.${k} non stringa: ${typeof v}`);
        assert.ok(v.length > 0, `${id}.${k} stringa vuota`);
      }
    }
  });
});
