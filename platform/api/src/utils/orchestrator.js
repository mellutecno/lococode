import { normalizeEntityName } from "./normalize.js";
import { DEFAULT_PERMISSIONS, PERMISSION_MODES } from "./permissions.js";

export function buildSystemPrompt() {
  return `Sei MelluCode Schema Generator. Converti la descrizione dell'app in definizioni di entità (tabelle dati).

Regole assolute:
1. Rispondi SOLO con un JSON array. Nessun markdown, nessuna spiegazione, nessun commento.
2. Ogni elemento è un oggetto con queste chiavi:
   - name: stringa, lowercase, inizia con a-z, max 80 caratteri, solo a-z, 0-9, underscore. Es: "class_bookings".
   - label: stringa, nome leggibile in italiano, max 160 caratteri. Es: "Prenotazioni Corsi".
   - schema: JSON Schema draft-07 compatibile Ajv che descrive i campi del record.
     - Deve avere type: "object" al top level.
     - Usa properties, required, type, format, enum, minLength, maxLength, minimum, maximum, pattern.
     - Formati supportati: email, uri, date-time, uuid, ipv4, ipv6, date.
     - Nomi campi in snake_case.
   - permissions: opzionale. Oggetto con chiavi read, create, update, delete. Valori ammessi: "none", "authenticated", "admin", "owner_or_admin". Se omesso usa i default.
   - metadata: opzionale. Oggetto libero per hint UI (icon, color). Se vuoto omesso.
3. Genera da 2 a 8 entità massimo. Concentrati sugli oggetti core del dominio.
4. Ogni entità deve avere almeno 2 proprietà e al massimo 15.
5. NON includere created_at / updated_at: il sistema li traccia automaticamente.
6. Non inventare campi non impliciti dalla descrizione utente.
7. Se la descrizione è vaga, inferisci valori ragionevoli ma mantieni gli schemi minimali e usabili.`;
}

export function extractJsonArray(text) {
  if (!text) return null;
  const trimmed = text.trim();

  // Tentativo diretto
  try {
    const parsed = JSON.parse(trimmed);
    if (Array.isArray(parsed)) return parsed;
    return null;
  } catch {}

  // Strip markdown fences
  const fence = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
  if (fence) {
    try {
      const parsed = JSON.parse(fence[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  // Trova primo blocco [ ... ]
  const bracket = trimmed.match(/(\[[\s\S]*\])/);
  if (bracket) {
    try {
      const parsed = JSON.parse(bracket[1]);
      if (Array.isArray(parsed)) return parsed;
    } catch {}
  }

  return null;
}

export function validateEntityDef(raw) {
  const errors = [];

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { ok: false, error: "Elemento non è un oggetto valido." };
  }

  // name
  const name = normalizeEntityName(raw.name);
  if (!name) {
    errors.push(`Nome entità non valido: "${raw.name}". Deve matchare ^[a-z][a-z0-9_]{0,79}$.`);
  }

  // label
  const label = typeof raw.label === "string" ? raw.label.trim() : name;

  // schema
  let jsonSchema = {};
  if (raw.schema !== undefined) {
    if (raw.schema && typeof raw.schema === "object" && !Array.isArray(raw.schema)) {
      jsonSchema = raw.schema;
      if (jsonSchema.type && jsonSchema.type !== "object") {
        errors.push("Lo schema top-level deve avere type: 'object'.");
      }
    } else {
      errors.push("schema deve essere un oggetto JSON.");
    }
  }

  // permissions
  let permissions = {};
  if (raw.permissions !== undefined) {
    if (raw.permissions && typeof raw.permissions === "object" && !Array.isArray(raw.permissions)) {
      for (const [k, v] of Object.entries(raw.permissions)) {
        if (!["read", "create", "update", "delete"].includes(k)) {
          errors.push(`Chiave permesso non valida: ${k}.`);
        } else if (!PERMISSION_MODES.includes(v)) {
          errors.push(`Valore permesso non valido per ${k}: ${v}.`);
        } else {
          permissions[k] = v;
        }
      }
    } else {
      errors.push("permissions deve essere un oggetto.");
    }
  }

  // metadata
  let metadata = {};
  if (raw.metadata !== undefined) {
    if (raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)) {
      metadata = raw.metadata;
    } else {
      errors.push("metadata deve essere un oggetto.");
    }
  }

  if (errors.length) {
    return { ok: false, error: errors.join("; ") };
  }

  return {
    ok: true,
    values: {
      name,
      label,
      schema: jsonSchema,
      permissions: { ...DEFAULT_PERMISSIONS, ...permissions },
      metadata,
    },
  };
}
