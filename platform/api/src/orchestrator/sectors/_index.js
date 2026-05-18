// Registry centrale dei settori disponibili.
// Ogni file in questa cartella esporta un oggetto con: id, label, description,
// keywords, theme (id da themes.js), entities (definitions stesso formato
// dell'output orchestrator).
//
// `inferSector(prompt)` fa matching keyword soft (case-insensitive + plurali)
// per indovinare il settore dal prompt utente. Niente AI qui — e' un fallback
// rapido e deterministico. La pipeline orchestrator puo' OVERRIDE-rlo lasciando
// che sia l'AI a scegliere fra i settori disponibili.

import palestra from "./palestra.js";
import ristorante from "./ristorante.js";
import negozio from "./negozio.js";
import studioProfessionale from "./studio-professionale.js";
import eventi from "./eventi.js";
import portfolio from "./portfolio.js";

export const SECTORS = Object.freeze({
  palestra,
  ristorante,
  negozio,
  "studio-professionale": studioProfessionale,
  eventi,
  portfolio,
});

export const SECTOR_IDS = Object.keys(SECTORS);

export function getSector(id) {
  return SECTORS[id] || null;
}

export function listSectors() {
  return Object.values(SECTORS).map((s) => ({
    id: s.id,
    label: s.label,
    description: s.description,
    theme: s.theme,
    entityCount: s.entities.length,
  }));
}

// Match veloce keyword -> settore. Conta hit pesati per lunghezza keyword
// (parole piu' lunghe = piu' significative). Restituisce il sector con score
// piu' alto, o null se nessun hit.
export function inferSector(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) return null;
  const haystack = " " + prompt.toLowerCase() + " ";
  let best = null;
  let bestScore = 0;
  for (const sector of Object.values(SECTORS)) {
    let score = 0;
    for (const kw of sector.keywords) {
      const needle = kw.toLowerCase();
      // match come parola intera (con spazi / punteggiatura attorno)
      const re = new RegExp(`[^a-z0-9]${escapeRegex(needle)}[^a-z0-9]`, "g");
      const matches = haystack.match(re);
      if (matches) score += matches.length * Math.max(1, Math.floor(needle.length / 3));
    }
    if (score > bestScore) {
      bestScore = score;
      best = sector;
    }
  }
  return best;
}

function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Lista compatta dei settori per il prompt orchestrator (few-shot light).
// Niente entita' qui — solo: id, label, vibe, theme. Cosi' l'AI sa cosa puo'
// scegliere senza essere subissata dal dettaglio.
export function sectorsPromptList() {
  return Object.values(SECTORS)
    .map((s) => `- ${s.id} (${s.label}) — tema: ${s.theme}. Esempi prompt: ${s.keywords.slice(0, 5).join(", ")}.`)
    .join("\n");
}
