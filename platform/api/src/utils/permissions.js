// Modello permessi per la Data API gestita.
// Ogni entita' definisce read/create/update/delete con uno di questi modi:
//   - "none"           nessuno (anche admin) puo' fare l'azione via API
//   - "authenticated"  qualsiasi utente app autenticato
//   - "admin"          solo utenti con role === "admin"
//   - "owner_or_admin" admin sempre, oppure utente che ha creato il record
//
// Default conservativo: lettura/creazione aperte agli autenticati,
// modifica/cancellazione solo a owner o admin.
export const DEFAULT_PERMISSIONS = Object.freeze({
  read: "authenticated",
  create: "authenticated",
  update: "owner_or_admin",
  delete: "owner_or_admin",
});

export const PERMISSION_MODES = Object.freeze(["none", "authenticated", "admin", "owner_or_admin"]);

export function permissionFor(entity, action) {
  const merged = { ...DEFAULT_PERMISSIONS, ...(entity?.permissions || {}) };
  const mode = merged[action];
  return PERMISSION_MODES.includes(mode) ? mode : DEFAULT_PERMISSIONS[action];
}

export function canAccess(entity, action, user, record = null) {
  if (!user) return false;
  const mode = permissionFor(entity, action);
  if (mode === "none") return false;
  if (mode === "authenticated") return true;
  if (mode === "admin") return user.role === "admin";
  if (mode === "owner_or_admin") {
    if (user.role === "admin") return true;
    return Boolean(record) && record.createdByAppUserId === user.id;
  }
  return false;
}
