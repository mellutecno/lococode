export function labelFromName(name = "") {
  return String(name || "")
    .replace(/_id$/i, "")
    .replace(/_file$/i, "")
    .replace(/_/g, " ")
    .trim()
    .replace(/\b\w/g, (m) => m.toUpperCase()) || "Campo";
}

export function entityLabel(entity) {
  return entity?.label || labelFromName(entity?.name || "");
}

// Campi "sistema" che il backend MelluCode gestisce automaticamente:
// id e' generato come UUID server-side in mc_app_records.id
// tenant_id, created_at, updated_at, created_by_*, updated_by_* sono colonne
// dedicate. Se l'AI per errore li mette in jsonSchema, li filtriamo qui
// cosi' il form non li espone come input editabili (difesa in profondita').
const SYSTEM_FIELDS = new Set([
  "id", "tenant_id", "tenantId",
  "created_at", "createdAt", "updated_at", "updatedAt",
  "created_by", "createdBy", "updated_by", "updatedBy",
  "created_by_app_user_id", "updated_by_app_user_id",
  "owner_app_user_id", "ownerAppUserId",
]);

export function isSystemField(name) {
  return SYSTEM_FIELDS.has(String(name || ""));
}

export function getFields(entity) {
  const schema = entity?.schema || {};
  const properties = schema.properties || {};
  const required = new Set(Array.isArray(schema.required) ? schema.required : []);

  return Object.entries(properties)
    .filter(([name]) => !isSystemField(name))
    .map(([name, def]) => {
      const field = def && typeof def === "object" ? def : {};
      return {
        name,
        label: field.title || labelFromName(name),
        type: field.type || "string",
        format: field.format,
        enum: Array.isArray(field.enum) ? field.enum : null,
        required: required.has(name),
        maxLength: field.maxLength,
        minLength: field.minLength,
        minimum: field.minimum,
        maximum: field.maximum,
        schema: field,
        kind: fieldKind(name, field),
      };
    });
}

// Heuristiche per riconoscere il tipo di input dal nome del campo,
// quando l'AI non ha specificato un format esplicito. Esempio: un campo
// chiamato "schedule" o "orario" deve aprire un widget time/datetime,
// non un text input vuoto.
const NAME_HEURISTICS = [
  // datetime-local: data + ora insieme (appuntamenti, prenotazioni, eventi)
  { re: /(data_ora|datetime|appointment|prenotazione|booking|inizio_evento|fine_evento|start_at|end_at|starts_at|ends_at)/i, kind: "datetime" },
  // time picker: ora del giorno (apertura, chiusura, orario lezione)
  { re: /^(ora|orario|hour|time|schedule|opening|chiusura|apertura)$|_(ora|orario|hour|time|inizio|fine|start|end)$/i, kind: "time" },
  // date picker: solo giorno (compleanno, scadenza, data evento)
  { re: /(_at$|^data$|_data$|date|scadenza|expiry|deadline|nascita|birth|emissione|consegna|delivery)/i, kind: "date" },
];

function fieldKind(name, field) {
  const n = String(name).toLowerCase();
  if (n.endsWith("_file_id") || n.includes("photo") || n.includes("image") || n.includes("logo")) return "file";
  if (Array.isArray(field.enum)) return "select";
  if (field.type === "boolean") return "boolean";
  if (field.type === "integer" || field.type === "number") return "number";
  if (field.type === "array" || field.type === "object") return "json";
  if (field.format === "email") return "email";
  if (field.format === "uri" || field.format === "url") return "url";
  if (field.format === "time") return "time";
  if (field.format === "date-time") return "datetime";
  if (field.format === "date") return "date";

  // Format non specificato: usa euristica sul nome del campo cosi' l'AI
  // puo' "sbagliare" e il template ricuce. Es. {name:"schedule",type:"string"}
  // -> riconosciuto come time picker, non text input vuoto.
  for (const h of NAME_HEURISTICS) {
    if (h.re.test(n)) return h.kind;
  }

  if ((field.maxLength || 0) > 220 || /note|notes|description|bio|message|content|descrizione/.test(n)) return "textarea";
  return "text";
}

export function primaryField(fields) {
  const preferred = ["name", "title", "label", "customer_name", "client_name", "nome", "titolo"];
  for (const key of preferred) {
    const found = fields.find((f) => f.name === key || f.name.endsWith(`_${key}`));
    if (found && found.kind !== "file") return found;
  }
  return fields.find((f) => f.required && f.type === "string" && f.kind !== "file") ||
         fields.find((f) => f.kind !== "file") ||
         fields[0] ||
         null;
}

export function photoField(fields) {
  return fields.find((f) => f.kind === "file") || null;
}

export function statusField(fields) {
  return fields.find((f) => f.kind === "select" && /status|stato|state/.test(f.name.toLowerCase())) ||
         fields.find((f) => f.kind === "select") ||
         null;
}

export function previewFields(fields, max = 4) {
  const primary = primaryField(fields);
  const photo = photoField(fields);
  return fields
    .filter((f) => f.name !== primary?.name && f.name !== photo?.name && f.kind !== "json")
    .slice(0, max);
}

export function emptyValue(field) {
  if (field.kind === "boolean") return false;
  if (field.kind === "select") return field.enum?.[0] || "";
  if (field.kind === "json") return "";
  return "";
}

export function inputValue(field, value) {
  if (value === undefined || value === null) return emptyValue(field);
  if (field.kind === "datetime" && typeof value === "string") return value.slice(0, 16);
  if (field.kind === "json") return typeof value === "string" ? value : JSON.stringify(value, null, 2);
  return value;
}

export function cleanPayload(fields, values) {
  const out = {};
  for (const field of fields) {
    const raw = values[field.name];
    if ((raw === "" || raw === null || raw === undefined) && !field.required) continue;

    if (field.kind === "number") {
      if (raw === "" || raw === null || raw === undefined) continue;
      const n = field.type === "integer" ? parseInt(raw, 10) : Number(raw);
      if (Number.isFinite(n)) out[field.name] = n;
      continue;
    }

    if (field.kind === "boolean") {
      out[field.name] = Boolean(raw);
      continue;
    }

    if (field.kind === "json") {
      if (raw === "" || raw === null || raw === undefined) continue;
      try {
        out[field.name] = typeof raw === "string" ? JSON.parse(raw) : raw;
      } catch {
        throw new Error(`Il campo "${field.label}" deve contenere JSON valido.`);
      }
      continue;
    }

    out[field.name] = raw;
  }
  return out;
}

export function formatValue(field, value) {
  if (value === undefined || value === null || value === "") return "-";
  if (field.kind === "boolean") return value ? "Si" : "No";
  if (field.kind === "date" || field.kind === "datetime") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) {
      return field.kind === "date"
        ? d.toLocaleDateString("it-IT")
        : d.toLocaleString("it-IT", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    }
  }
  if (field.name.endsWith("_cents") && Number.isFinite(Number(value))) {
    return (Number(value) / 100).toLocaleString("it-IT", { style: "currency", currency: "EUR" });
  }
  if (Array.isArray(value)) return value.join(", ");
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}
