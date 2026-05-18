import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { SECTORS, SECTOR_IDS, getSector, listSectors, inferSector, sectorsPromptList } from "./sectors/_index.js";
import { isValidThemeId, THEMES, themesPromptList } from "./themes.js";
import { validateEntityDef } from "../utils/orchestrator.js";

describe("THEMES registry", () => {
  test("contains at least the 7 base themes", () => {
    assert.ok(Object.keys(THEMES).length >= 7);
    for (const id of ["dark-electric", "warm-amber", "light-modern", "navy-trust", "editorial-rose", "dark-cyan", "sage-wellness"]) {
      assert.ok(THEMES[id], `tema ${id} mancante`);
      assert.ok(isValidThemeId(id));
    }
  });

  test("isValidThemeId rejects unknown ids", () => {
    assert.equal(isValidThemeId("non-esiste"), false);
    assert.equal(isValidThemeId(""), false);
    assert.equal(isValidThemeId(null), false);
  });

  test("themesPromptList includes every theme id and vibe", () => {
    const out = themesPromptList();
    for (const id of Object.keys(THEMES)) {
      assert.ok(out.includes(id), `${id} non presente nel prompt list`);
    }
  });
});

describe("SECTORS registry", () => {
  test("registers at least 6 sectors", () => {
    assert.ok(SECTOR_IDS.length >= 6, `attesi >=6 settori, trovati ${SECTOR_IDS.length}`);
  });

  test("every sector has required keys", () => {
    for (const s of Object.values(SECTORS)) {
      assert.ok(s.id, `settore senza id: ${JSON.stringify(s).slice(0, 80)}`);
      assert.ok(s.label, `${s.id}: label mancante`);
      assert.ok(s.description, `${s.id}: description mancante`);
      assert.ok(Array.isArray(s.keywords) && s.keywords.length > 0, `${s.id}: keywords vuoto`);
      assert.ok(s.theme, `${s.id}: theme mancante`);
      assert.ok(isValidThemeId(s.theme), `${s.id}: theme "${s.theme}" non in THEMES`);
      assert.ok(Array.isArray(s.entities) && s.entities.length > 0, `${s.id}: entities vuoto`);
    }
  });

  test("every entity of every sector passes validateEntityDef", () => {
    for (const s of Object.values(SECTORS)) {
      for (const e of s.entities) {
        const v = validateEntityDef(e);
        assert.equal(v.ok, true, `${s.id}/${e?.name}: validate failed: ${v.error}`);
        // schema deve avere type object
        assert.equal(v.values.schema.type ?? "object", "object", `${s.id}/${e.name}: schema.type non object`);
      }
    }
  });

  test("every sector exports >= 3 entities (sensible coverage)", () => {
    for (const s of Object.values(SECTORS)) {
      assert.ok(s.entities.length >= 3, `${s.id}: solo ${s.entities.length} entita' (atteso >=3)`);
    }
  });
});

describe("getSector / listSectors", () => {
  test("getSector returns the requested sector by id", () => {
    assert.equal(getSector("palestra")?.id, "palestra");
    assert.equal(getSector("ristorante")?.id, "ristorante");
  });

  test("getSector returns null for unknown id", () => {
    assert.equal(getSector("klingon-bath"), null);
    assert.equal(getSector(""), null);
  });

  test("listSectors returns slim metadata for each sector", () => {
    const list = listSectors();
    assert.ok(Array.isArray(list));
    assert.ok(list.length >= 6);
    for (const item of list) {
      assert.ok(item.id);
      assert.ok(item.label);
      assert.ok(item.theme);
      assert.equal(typeof item.entityCount, "number");
    }
  });
});

describe("inferSector keyword matching", () => {
  test("matches palestra prompt", () => {
    assert.equal(inferSector("Voglio gestire la mia palestra con membri e corsi")?.id, "palestra");
    assert.equal(inferSector("App per personal trainer e prenotazioni allenamento")?.id, "palestra");
  });

  test("matches ristorante prompt", () => {
    assert.equal(inferSector("Pizzeria con menu e prenotazione tavoli")?.id, "ristorante");
    assert.equal(inferSector("Sistema per la mia trattoria, ordini e tavoli")?.id, "ristorante");
  });

  test("matches negozio prompt", () => {
    assert.equal(inferSector("Voglio un piccolo e-commerce per i miei prodotti di abbigliamento")?.id, "negozio");
    assert.equal(inferSector("Gestione catalogo articoli e ordini clienti")?.id, "negozio");
  });

  test("matches studio professionale prompt", () => {
    assert.equal(inferSector("Studio legale: clienti, pratiche e appuntamenti")?.id, "studio-professionale");
    assert.equal(inferSector("Sono un dentista, gestione assistiti e appuntamenti")?.id, "studio-professionale");
  });

  test("matches eventi prompt", () => {
    assert.equal(inferSector("Wedding planner: matrimoni, fornitori, invitati")?.id, "eventi");
  });

  test("matches portfolio prompt", () => {
    assert.equal(inferSector("Portfolio designer con case study e testimonianze")?.id, "portfolio");
  });

  test("returns null for irrelevant prompt", () => {
    assert.equal(inferSector("xyz qwerty zxcvb foobar"), null);
    assert.equal(inferSector(""), null);
    assert.equal(inferSector(null), null);
    assert.equal(inferSector(undefined), null);
  });
});

describe("sectorsPromptList", () => {
  test("includes every sector id and theme", () => {
    const out = sectorsPromptList();
    for (const s of Object.values(SECTORS)) {
      assert.ok(out.includes(s.id), `${s.id} mancante nel prompt list`);
      assert.ok(out.includes(s.theme), `${s.theme} mancante nel prompt list per ${s.id}`);
    }
  });
});
