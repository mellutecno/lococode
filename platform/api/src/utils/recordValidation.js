// Validazione record contro il json_schema definito da `mc_app_entities`.
// Usa Ajv (draft-07 di default) + ajv-formats per i format comuni (email, uri,
// date-time, uuid, ipv4, ipv6, ...). Gli errori di Ajv vengono tradotti in
// messaggi italiani brevi adatti a essere mostrati nel frontend.
//
// Manteniamo un comportamento "extra" rispetto a JSON Schema puro: una stringa
// vuota su un campo `required` viene considerata mancante (UX form HTML).
// Questo viene controllato PRIMA di Ajv per produrre lo stesso messaggio del
// caso "campo proprio assente".
//
// Le schema compilate sono cachate in una Map keyed by JSON.stringify(schema):
// stesso schema = stessa validate function. La cache cresce con il numero di
// entita' distinte (in pratica decine), quindi e' OK in memoria.
import Ajv from "ajv";
import addFormats from "ajv-formats";

const ajv = new Ajv({
  allErrors: false,        // basta il primo errore per il messaggio utente
  strict: false,           // tolleranti su keyword non standard (es. shadcn ui hints)
  coerceTypes: false,      // niente coercion: meglio errore che dato sbagliato
  useDefaults: true,       // applica `default` definito nello schema
  removeAdditional: false, // additionalProperties=false produce errore, non strip
});
addFormats(ajv);

const compileCache = new Map();

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

// Campi gestiti dal sistema, MAI editabili dall'utente:
// mc_app_records.id e' generato come UUID server-side; tenant_id, created_at,
// updated_at, created_by_app_user_id, updated_by_app_user_id sono colonne
// dedicate. Se l'AI per errore li mette nel jsonSchema (campo o required),
// li ignoriamo durante la validazione cosi' il form utente non si rompe.
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

// Restituisce una versione del jsonSchema "pulita" senza system fields
// (sia in properties sia in required). Cache implicita tramite compileCache
// che gia' usa la stringa del schema risultante come chiave.
export function stripSystemFieldsFromSchema(jsonSchema) {
  if (!isPlainObject(jsonSchema)) return jsonSchema;
  const props = isPlainObject(jsonSchema.properties) ? jsonSchema.properties : null;
  const req = Array.isArray(jsonSchema.required) ? jsonSchema.required : null;
  if (!props && !req) return jsonSchema;

  const next = { ...jsonSchema };
  if (props) {
    const cleaned = {};
    for (const [k, v] of Object.entries(props)) {
      if (!isSystemField(k)) cleaned[k] = v;
    }
    if (Object.keys(cleaned).length !== Object.keys(props).length) {
      next.properties = cleaned;
    }
  }
  if (req) {
    const cleanedReq = req.filter((k) => !isSystemField(k));
    if (cleanedReq.length !== req.length) {
      next.required = cleanedReq;
    }
  }
  return next;
}

export function stripSystemFieldsFromData(data) {
  if (!isPlainObject(data)) return data;
  let dirty = false;
  for (const k of Object.keys(data)) if (isSystemField(k)) { dirty = true; break; }
  if (!dirty) return data;
  return Object.fromEntries(Object.entries(data).filter(([k]) => !isSystemField(k)));
}

function compileFor(jsonSchema) {
  const key = JSON.stringify(jsonSchema);
  let validate = compileCache.get(key);
  if (!validate) {
    // Forziamo type=object al top-level: i record sono sempre oggetti.
    const fullSchema = { type: "object", ...jsonSchema };
    validate = ajv.compile(fullSchema);
    compileCache.set(key, validate);
  }
  return validate;
}

// Tradotti dall'inglese di Ajv all'italiano corto: solo i keyword che usiamo
// realmente. Per il resto, fallback generico.
const ITALIAN_TYPE = {
  string: "testo",
  number: "numerico",
  integer: "intero",
  boolean: "vero/falso",
  object: "un oggetto",
  array: "una lista",
  null: "null",
};

function fieldFromError(err) {
  const path = err.instancePath || "";
  // /products/0/name  ->  products.0.name
  const cleaned = path.replace(/^\//, "").replace(/\//g, ".");
  if (cleaned) return cleaned;
  if (err.params?.missingProperty) return err.params.missingProperty;
  if (err.params?.additionalProperty) return err.params.additionalProperty;
  return "campo";
}

function formatAjvError(err) {
  const field = fieldFromError(err);
  switch (err.keyword) {
    case "required":
      return `Campo obbligatorio mancante: ${err.params.missingProperty}.`;
    case "additionalProperties":
      return `Campo non previsto: ${err.params.additionalProperty}.`;
    case "type": {
      const t = ITALIAN_TYPE[err.params.type] || err.params.type;
      const article = (t === "un oggetto" || t === "una lista") ? "deve essere" : "deve essere";
      return `${field} ${article} ${t}.`;
    }
    case "maxLength":
      return `${field} supera la lunghezza massima.`;
    case "minLength":
      return `${field} e' troppo corto.`;
    case "pattern":
      return `${field} non rispetta il formato richiesto.`;
    case "format":
      return `${field} non e' un valore valido (${err.params.format}).`;
    case "enum":
      return `${field} deve essere uno tra: ${err.params.allowedValues.join(", ")}.`;
    case "minimum":
      return `${field} deve essere >= ${err.params.limit}.`;
    case "maximum":
      return `${field} deve essere <= ${err.params.limit}.`;
    case "exclusiveMinimum":
      return `${field} deve essere > ${err.params.limit}.`;
    case "exclusiveMaximum":
      return `${field} deve essere < ${err.params.limit}.`;
    case "multipleOf":
      return `${field} deve essere multiplo di ${err.params.multipleOf}.`;
    case "minItems":
      return `${field} deve avere almeno ${err.params.limit} elementi.`;
    case "maxItems":
      return `${field} puo' avere al massimo ${err.params.limit} elementi.`;
    case "uniqueItems":
      return `${field} non puo' contenere duplicati.`;
    default:
      return `${field} non valido (${err.keyword}).`;
  }
}

export function validateRecordData(entity, data) {
  if (!isPlainObject(data)) return "Il record deve essere un oggetto JSON.";

  // Filtra system fields sia da data (ricevuti dal client) sia dallo schema
  // dell'entita' (potrebbero essere stati messi per errore dall'AI). Difesa
  // in profondita': anche se il template e' aggiornato, l'API resta safe.
  const cleanData = stripSystemFieldsFromData(data);
  const rawSchema = isPlainObject(entity?.jsonSchema) ? entity.jsonSchema : {};
  const jsonSchema = stripSystemFieldsFromSchema(rawSchema);

  // Required pre-check (semantica UX form HTML, non standard JSON Schema):
  // undefined / null / "" su un campo required vengono trattati come mancanti.
  // Lo facciamo prima di Ajv perche' Ajv considera null come "valore di tipo null".
  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];
  for (const field of required) {
    const v = cleanData[field];
    if (v === undefined || v === null || v === "") {
      return `Campo obbligatorio mancante: ${field}.`;
    }
  }

  // Schema vuoto = nessun vincolo.
  if (Object.keys(jsonSchema).length === 0) return null;

  // Per i campi NON required, un null esplicito viene ignorato (compat v1).
  // I valori required null sono gia' stati rifiutati sopra.
  let dataForAjv = cleanData;
  const hasNullOptional = Object.values(cleanData).some((v) => v === null);
  if (hasNullOptional) {
    dataForAjv = Object.fromEntries(
      Object.entries(cleanData).filter(([, v]) => v !== null)
    );
  }

  let validate;
  try {
    validate = compileFor(jsonSchema);
  } catch (err) {
    // Schema malformato dal lato definizione entita': non blocchiamo il record
    // dell'utente per un errore della definizione, ma ritorniamo errore chiaro.
    return `Schema entita' non valido: ${err.message}`;
  }

  if (validate(dataForAjv)) return null;
  return formatAjvError(validate.errors[0]);
}

// Esposta per test / debug. Non usata in produzione.
export function _clearValidationCache() {
  compileCache.clear();
}
