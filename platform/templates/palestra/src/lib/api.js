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
  if (!subscriptionUntil) return { label: "Non attivo", tone: "rose" };
  const end = new Date(subscriptionUntil);
  const now = new Date();
  if (Number.isNaN(end.getTime())) return { label: "Data non valida", tone: "rose" };
  if (end < now) return { label: "Scaduto", tone: "rose" };
  const days = Math.ceil((end - now) / (1000 * 60 * 60 * 24));
  if (days <= 14) return { label: `Scade fra ${days} g.`, tone: "amber" };
  return { label: "Attivo", tone: "emerald" };
}
