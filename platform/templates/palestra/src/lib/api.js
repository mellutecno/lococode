// Singleton MelluCode client per l'intera app. Tutto passa da qui: niente
// fetch manuali in giro per le pagine.
//
// - tenantSlug e' hard-coded perche' questa e' un'app pre-cucita per UN tenant
//   (la palestra demo). Quando l'orchestrator generera' altri template, il
//   tenantSlug verra' iniettato da env.
// - apiUrl: in dev vite proxy /v1/* verso il backend reale (vedi vite.config.js),
//   in produzione l'app gira sullo stesso origin del backend.
import { MelluCode } from "mellucode-sdk";

export const TENANT_SLUG = "palestra-demo";

export const mc = new MelluCode({
  apiUrl: "",
  tenantSlug: TENANT_SLUG,
});

export const MEMBERS_ENTITY = "members";

// Stato abbonamento calcolato lato client da subscription_until.
// Verde se attivo, ambra se scade nei prossimi 14gg, rosso se scaduto.
export function subscriptionStatus(subscriptionUntil) {
  if (!subscriptionUntil) return { label: "Non attivo", tone: "rose", daysLeft: null };
  const end = new Date(subscriptionUntil);
  const now = new Date();
  if (Number.isNaN(end.getTime())) return { label: "Data non valida", tone: "rose", daysLeft: null };
  if (end < now) return { label: "Scaduto", tone: "rose", daysLeft: 0 };
  const days = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  if (days <= 14) return { label: `Scade in ${days} g.`, tone: "amber", daysLeft: days };
  return { label: "Attivo", tone: "emerald", daysLeft: days };
}

const SUB_LABEL = {
  monthly:   "Mensile",
  quarterly: "Trimestrale",
  yearly:    "Annuale",
  none:      "Nessuno",
};
export function subscriptionTypeLabel(t) { return SUB_LABEL[t] || "—"; }

// Date formatter italiano breve, immune a Date invalide.
export function formatDateIt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

// Calcola stats di una lista record per il dashboard header.
export function computeStats(records = []) {
  const stats = { total: records.length, active: 0, expiring: 0, expired: 0 };
  for (const r of records) {
    const s = subscriptionStatus(r.data?.subscription_until);
    if (s.tone === "emerald") stats.active++;
    else if (s.tone === "amber") stats.expiring++;
    else stats.expired++;
  }
  return stats;
}
