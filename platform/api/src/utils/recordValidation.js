// Validazione record contro il json_schema dell'entita'.
// Volutamente "JSON Schema light": copre i casi base (required, type, maxLength,
// additionalProperties=false) senza tirare dentro Ajv. Per la v1.0 commerciale
// si sostituira' con Ajv full — vedi HANDOFF.md.
export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function validateRecordData(entity, data) {
  if (!isPlainObject(data)) return "Il record deve essere un oggetto JSON.";

  const jsonSchema = isPlainObject(entity?.jsonSchema) ? entity.jsonSchema : {};
  const properties = isPlainObject(jsonSchema.properties) ? jsonSchema.properties : {};
  const required = Array.isArray(jsonSchema.required) ? jsonSchema.required : [];

  for (const field of required) {
    const v = data[field];
    if (v === undefined || v === null || v === "") {
      return `Campo obbligatorio mancante: ${field}.`;
    }
  }

  if (jsonSchema.additionalProperties === false) {
    for (const field of Object.keys(data)) {
      if (!properties[field]) return `Campo non previsto: ${field}.`;
    }
  }

  for (const [field, rules] of Object.entries(properties)) {
    const value = data[field];
    if (value === undefined || value === null) continue;
    if (!isPlainObject(rules)) continue;

    if (rules.type === "string" && typeof value !== "string") return `${field} deve essere testo.`;
    if (rules.type === "number" && typeof value !== "number") return `${field} deve essere numerico.`;
    if (rules.type === "integer" && !Number.isInteger(value)) return `${field} deve essere intero.`;
    if (rules.type === "boolean" && typeof value !== "boolean") return `${field} deve essere vero/falso.`;
    if (rules.type === "object" && !isPlainObject(value)) return `${field} deve essere un oggetto.`;
    if (rules.type === "array" && !Array.isArray(value)) return `${field} deve essere una lista.`;
    if (rules.type === "string" && rules.maxLength && value.length > rules.maxLength) {
      return `${field} supera la lunghezza massima.`;
    }
  }

  return null;
}
