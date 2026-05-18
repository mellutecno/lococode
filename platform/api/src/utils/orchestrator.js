import { normalizeEntityName } from "./normalize.js";
import { DEFAULT_PERMISSIONS, PERMISSION_MODES } from "./permissions.js";
import { THEME_IDS, themesPromptList } from "../orchestrator/themes.js";
import { sectorsPromptList } from "../orchestrator/sectors/_index.js";

// Brief estetico distillato per il system prompt orchestrator.
// Versione condensata di docs/orchestrator-design-quality.md adatta a stare
// dentro un token budget ragionevole.
const DESIGN_BRIEF_SHORT = `BRIEF DESIGN (obbligatorio):
Le app generate da MelluCode devono avere qualita' estetica premium ispirata
ai migliori siti su Awwwards, CSS Design Awards, Land-book, Godly. Non
generare mai schemi pensati per UI generiche o "amministrativi grigi".

Le label delle entita' e dei campi devono essere in italiano corretto,
naturali, da prodotto vero. Mai testi tipo "Entita' X" o "Campo Y".

Per ogni entita' includi sempre, dove ha senso, un campo immagine/foto
(\`*_file_id\` di tipo string) o un campo cover, cosi' il frontend
generato puo' produrre card visivamente forti e non solo righe di tabella.
Includi date/timestamp dove modellano lo stato reale (es. \`starts_at\`,
\`subscription_until\`, \`status\` enum). Niente \`created_at\`/\`updated_at\`:
li traccia il sistema.

La qualita' visiva e' parte del valore. Schema brutto -> UI brutta.`;

const THEMES_BLOCK = `TEMI VISIVI DISPONIBILI (id da scegliere — non inventarne altri):
${themesPromptList()}`;

const SECTORS_BLOCK = `CATALOGO SETTORI (per orientamento — puoi anche generare per settori non in lista):
${sectorsPromptList()}`;

function sectorHintBlock(sector) {
  if (!sector) return "";
  // Mostriamo solo nomi entita' di riferimento (senza fields completi):
  // serve per orientare l'AI sul taglio del dominio, NON per farle copiare
  // i nostri schemi. La struttura concreta delle entita' deve essere guidata
  // dal prompt utente, non dal nostro template.
  const referenceNames = sector.entities.map((e) => `${e.name} (${e.label})`).join(", ");
  return `\n\nORIENTAMENTO SETTORE (inferito automaticamente, NON vincolante):
Il prompt sembra del settore "${sector.id}" (${sector.label}). Tema raccomandato: "${sector.theme}".
A titolo di esempio, app simili usano entita' come: ${referenceNames}.

ATTENZIONE — REGOLE DI PRIORITA':
1. Il PROMPT UTENTE e' la fonte di verita'. Genera entita' che riflettono
   quello che l'utente ha effettivamente descritto, NON il riferimento.
2. Usa il riferimento SOLO per:
   - confermare il tema visivo (puoi mettere theme="${sector.theme}" sulla
     prima entita');
   - capire il livello di granularita' atteso (es. 3-4 entita' core).
3. Se l'utente ha descritto un dominio diverso da quello del riferimento,
   IGNORA COMPLETAMENTE il riferimento e segui il prompt.`;
}

// `buildSystemPrompt(context)` produce il system prompt completo dell'orchestrator.
// `context` opzionale: { sector?, designBrief?, themes?, includeCatalog? }
// Default (chiamata senza args) restituisce il prompt minimo storico — i test
// vecchi continuano a passare.
export function buildSystemPrompt(context = {}) {
  const {
    sector = null,
    designBrief = true,
    themes = true,
    includeCatalog = true,
  } = context;

  const parts = [
    `Sei MelluCode Schema Generator. Trasformi la descrizione di un'app in definizioni di entita' (tabelle dati) gia' pronte per il database e per il frontend.

Regole assolute output:
1. Rispondi SOLO con un JSON array. Nessun markdown, nessuna spiegazione, nessun commento prima/dopo.
2. Ogni elemento e' un oggetto con queste chiavi:
   - name: stringa, lowercase, ^[a-z][a-z0-9_]{0,79}$. snake_case. Es: "class_bookings".
   - label: stringa italiana naturale, max 160 caratteri. Es: "Prenotazioni Corsi".
   - schema: JSON Schema draft-07 compatibile Ajv:
     - type: "object" al top level
     - properties con campi snake_case
     - required: array dei campi obbligatori
     - usa: type, format (email|uri|uuid|date-time|date), enum, minLength,
       maxLength, minimum, maximum, pattern, items per array
   - permissions: opzionale. { read, create, update, delete } con valori
     "none" | "authenticated" | "admin" | "owner_or_admin". Default: read/create
     authenticated, update/delete owner_or_admin.
   - metadata: opzionale. { icon?: string (nome lucide), primary?: boolean,
     theme?: id valido }. Theme se presente DEVE essere uno della lista temi
     disponibili sotto. Mettilo solo sulla PRIMA entita' (quella primary),
     diventera' il tema dell'app intera.
3. Genera da 2 a 8 entita' massimo. Concentrati sugli oggetti core del dominio.
4. Ogni entita' deve avere fra 2 e 15 proprieta'.
5. NON INCLUDERE MAI questi campi (li gestisce il sistema, mai l'utente):
   - id (chiave primaria, generata server-side come UUID)
   - tenant_id, tenantId (isolamento multi-tenant, automatico)
   - created_at, createdAt, updated_at, updatedAt (timestamps)
   - created_by, updated_by, created_by_app_user_id, updated_by_app_user_id
     (chi ha creato/modificato il record, tracciato automaticamente)
   Se metti uno di questi nelle properties o required, l'utente vedra' un
   campo "ID" da riempire a mano nel form -> bug grave, NON FARLO.
6. Se la descrizione e' vaga, inferisci valori ragionevoli ma resta minimale.`,
  ];

  if (designBrief) parts.push(DESIGN_BRIEF_SHORT);
  if (themes) parts.push(THEMES_BLOCK);
  if (includeCatalog) parts.push(SECTORS_BLOCK);
  if (sector) parts.push(sectorHintBlock(sector));

  return parts.join("\n\n");
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

  // metadata (libero ma con whitelist per theme)
  let metadata = {};
  if (raw.metadata !== undefined) {
    if (raw.metadata && typeof raw.metadata === "object" && !Array.isArray(raw.metadata)) {
      metadata = { ...raw.metadata };
      if (metadata.theme !== undefined && metadata.theme !== null && metadata.theme !== "") {
        if (typeof metadata.theme !== "string" || !THEME_IDS.includes(metadata.theme)) {
          errors.push(`metadata.theme "${metadata.theme}" non è un tema valido. Ammessi: ${THEME_IDS.join(", ")}.`);
        }
      }
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

// Estrae il tema scelto dall'AI scorrendo le entita' (la prima primary o la
// prima con `metadata.theme`). Se nessuna lo specifica, ritorna fallback.
export function pickThemeFromEntities(entityValues, fallback = null) {
  if (!Array.isArray(entityValues)) return fallback;
  for (const v of entityValues) {
    const t = v?.values?.metadata?.theme;
    if (t && THEME_IDS.includes(t)) return t;
  }
  return fallback;
}
