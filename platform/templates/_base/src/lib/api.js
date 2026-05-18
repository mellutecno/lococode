// Singleton MelluCode + costanti app generate.
// I valori __APP_*__, __TENANT_SLUG__, __PRIMARY_ENTITY_*__ sono sostituiti
// dal frontendBuilder al build time.
import { MelluCode } from "mellucode-sdk";

export const APP_NAME = "__APP_NAME__";
export const APP_SUBTITLE = "__APP_SUBTITLE__";
export const TENANT_SLUG = "__TENANT_SLUG__";
export const PRIMARY_ENTITY = "__PRIMARY_ENTITY_NAME__";
export const PRIMARY_ENTITY_LABEL = "__PRIMARY_ENTITY_LABEL__";
export const PRIMARY_ENTITY_LABEL_PLURAL = "__PRIMARY_ENTITY_LABEL_PLURAL__";

export const mc = new MelluCode({
  apiUrl: "",
  tenantSlug: TENANT_SLUG,
});

// Status pill helper generico. Senza contesto sul dominio, riconosce
// pattern comuni in italiano e inglese (success/pending/failed) e fa
// pill neutra per il resto.
export function statusTone(value) {
  if (!value) return "neutral";
  const v = String(value).toLowerCase();
  if (/(success|completed|done|active|attivo|completato|paid|confirmed|approvato|ok)/.test(v)) return "emerald";
  if (/(pending|waiting|in[_-]?progress|scheduled|in[_ ]?attesa|in[_ ]?corso|draft|bozza)/.test(v)) return "amber";
  if (/(fail|cancel|expired|scaduto|fallito|rifiutato|deleted|archived|annullato)/.test(v)) return "rose";
  return "neutral";
}

export function formatDateIt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(iso))) {
    return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
  }
  return d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatCents(cents) {
  if (cents === null || cents === undefined || cents === "") return "—";
  const n = Number(cents);
  if (!Number.isFinite(n)) return "—";
  return (n / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
}
