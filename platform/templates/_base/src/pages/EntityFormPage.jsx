import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Loader2, Save } from "lucide-react";
import { PRIMARY_ENTITY, PRIMARY_ENTITY_LABEL, mc } from "../lib/api.js";
import { FieldInput } from "../components/FieldRenderer.jsx";
import { cleanPayload, getFields, inputValue } from "../lib/entityIntrospect.js";

function pickPrimaryEntity(entities) {
  return entities.find((e) => e.name === PRIMARY_ENTITY) ||
    entities.find((e) => e.metadata?.primary) ||
    entities[0] ||
    null;
}

function buildInitialValues(fields, record) {
  const data = record?.data || {};
  const out = {};
  for (const field of fields) out[field.name] = inputValue(field, data[field.name]);
  return out;
}

export default function EntityFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

  const [entity, setEntity] = useState(null);
  const [record, setRecord] = useState(null);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);

  const fields = useMemo(() => getFields(entity), [entity]);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const entityRes = await mc.entities.list();
      const nextEntity = pickPrimaryEntity(entityRes.entities || []);
      if (!nextEntity) throw new Error("Schema dati non disponibile.");
      setEntity(nextEntity);

      let nextRecord = null;
      if (isEdit) {
        const recordRes = await mc.data(nextEntity.name).get(id);
        nextRecord = recordRes.record;
        setRecord(nextRecord);
      }

      setValues(buildInitialValues(getFields(nextEntity), nextRecord));
    } catch (err) {
      setError(err.message || "Non riesco a preparare il form.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  function updateField(name, value) {
    setValues((prev) => ({ ...prev, [name]: value }));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    if (!entity) return;
    setSaving(true);
    setError(null);
    try {
      const payload = cleanPayload(fields, values);
      const res = isEdit
        ? await mc.data(entity.name).update(id, payload)
        : await mc.data(entity.name).create(payload);
      navigate(`/r/${res.record.id}`, { replace: true });
    } catch (err) {
      setError(err.message || "Salvataggio non riuscito.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-32 text-ink-500 text-sm">
        <Loader2 className="w-5 h-5 animate-spin text-accent-300 mb-3" />
        Carico...
      </div>
    );
  }

  if (error && !entity) {
    return (
      <div className="card p-6 border-rose-400/30 bg-rose-500/5 max-w-xl mx-auto">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-rose-300 mt-0.5" />
          <div>
            <h2 className="text-lg text-rose-100">Non posso aprire il form</h2>
            <p className="text-sm text-rose-200/80 mt-1">{error}</p>
            <Link to="/" className="btn-secondary btn-sm mt-4">Torna alla lista</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to={isEdit ? `/r/${id}` : "/"} className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-100 transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        Indietro
      </Link>

      <section className="card p-6 sm:p-8">
        <div className="mb-7">
          <p className="text-xs uppercase tracking-[0.18em] text-accent-300 font-medium mb-2">
            {isEdit ? "Modifica" : "Nuovo"}
          </p>
          <h1>{isEdit ? `Modifica ${PRIMARY_ENTITY_LABEL.toLowerCase()}` : `Aggiungi ${PRIMARY_ENTITY_LABEL.toLowerCase()}`}</h1>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {fields.map((field) => (
            <div key={field.name} className="field">
              <label className="label">
                {field.label}{field.required ? " *" : ""}
              </label>
              <FieldInput
                field={field}
                value={values[field.name]}
                onChange={(value) => updateField(field.name, value)}
              />
            </div>
          ))}

          {error && (
            <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
              {error}
            </div>
          )}

          <div className="pt-3 flex flex-col-reverse sm:flex-row sm:justify-end gap-2">
            <Link to={isEdit ? `/r/${record?.id || id}` : "/"} className="btn-ghost">
              Annulla
            </Link>
            <button type="submit" className="btn-primary" disabled={saving}>
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {saving ? "Salvo..." : "Salva"}
            </button>
          </div>
        </form>
      </section>
    </div>
  );
}
