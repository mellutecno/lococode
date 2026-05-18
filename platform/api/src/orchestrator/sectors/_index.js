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

// Soglia minima di confidenza per ritornare un settore.
// Sotto questa soglia consideriamo l'inferenza non affidabile e ritorniamo
// null — l'orchestrator generera' senza sector hint, evitando bias verso
// un settore sbagliato.
const INFER_MIN_SCORE = 3;

// Stem italiano molto basico: rimuove flessione fine parola comune
// (sing/plur/masc/fem) per evitare miss su "paziente" vs "pazienti",
// "avvocato" vs "avvocati", "matrimonio" vs "matrimoni" ecc.
// Esempi: "pazienti" -> "pazient", "paziente" -> "pazient", "dentista"
// -> "dentist", "dentisti" -> "dentist".
// NB: non e' uno stemmer linguisticamente corretto, e' una euristica
// abbastanza buona per il nostro matching settoriale. False positive
// sono accettabili perche' il threshold scarta i match deboli.
function italianStem(word) {
  if (word.length <= 3) return word;
  // Rimuovi al massimo 3 caratteri finali su digramma flesso
  return word
    .replace(/(?:zione|sione|mento|gione)$/, "")
    .replace(/(?:tori|trici|tore|trice)$/, "")
    .replace(/(?:ette|etti|otta|otti)$/, "")
    .replace(/(?:che|chi|ghe|ghi|ie|ce|ci|gi|ge)$/, "")
    .replace(/[aeiou]$/, "");
}

function tokenize(text) {
  return text.toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

// Stem-set di un testo: insieme di stem unici delle parole.
function stemSet(text) {
  const out = new Set();
  for (const tok of tokenize(text)) out.add(italianStem(tok));
  return out;
}

// Stem-list per una keyword multi-parola: array degli stem di ogni parola.
// Tutte devono comparire (in qualsiasi ordine) negli stem del prompt.
function keywordStems(keyword) {
  return tokenize(keyword).map(italianStem);
}

function scoreKeywordAgainstStems(kwStems, promptStems) {
  for (const s of kwStems) if (!promptStems.has(s)) return 0;
  // peso = somma lunghezze degli stem (parole piu' lunghe/composte pesano di piu')
  return kwStems.reduce((acc, s) => acc + Math.max(2, s.length), 0);
}

function computeBest(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) return { sector: null, score: 0 };
  const ps = stemSet(prompt);
  let best = null;
  let bestScore = 0;
  for (const sector of Object.values(SECTORS)) {
    let score = 0;
    for (const kw of sector.keywords) {
      const s = scoreKeywordAgainstStems(keywordStems(kw), ps);
      if (s > 0) score += s;
    }
    if (score > bestScore) { bestScore = score; best = sector; }
  }
  return { sector: best, score: bestScore };
}

// Match keyword -> settore via stem italiano (sing/plur tolerant).
// Ritorna sector con score piu' alto SE supera INFER_MIN_SCORE, altrimenti null.
export function inferSector(prompt) {
  const { sector, score } = computeBest(prompt);
  if (score < INFER_MIN_SCORE) return null;
  return sector;
}

// Esposto per debug: stesso risultato + score + threshold visibili.
export function inferSectorWithScore(prompt) {
  const r = computeBest(prompt);
  return { ...r, threshold: INFER_MIN_SCORE };
}

// Lista compatta dei settori per il prompt orchestrator (few-shot light).
// Niente entita' qui — solo: id, label, vibe, theme. Cosi' l'AI sa cosa puo'
// scegliere senza essere subissata dal dettaglio.
export function sectorsPromptList() {
  return Object.values(SECTORS)
    .map((s) => `- ${s.id} (${s.label}) — tema: ${s.theme}. Esempi prompt: ${s.keywords.slice(0, 5).join(", ")}.`)
    .join("\n");
}
