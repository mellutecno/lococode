import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { AlertCircle, ArrowLeft, Loader2, Pencil, Trash2 } from "lucide-react";
import { PRIMARY_ENTITY, PRIMARY_ENTITY_LABEL, mc, statusTone } from "../lib/api.js";
import Avatar from "../components/Avatar.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { DisplayValue } from "../components/FieldRenderer.jsx";
import { formatValue, getFields, photoField, primaryField, statusField } from "../lib/entityIntrospect.js";

function pickPrimaryEntity(entities) {
  return entities.find((e) => e.name === PRIMARY_ENTITY) ||
    entities.find((e) => e.metadata?.primary) ||
    entities[0] ||
    null;
}

export default function EntityDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [entity, setEntity] = useState(null);
  const [record, setRecord] = useState(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(null);

  const fields = useMemo(() => getFields(entity), [entity]);
  const data = record?.data || {};
  const titleField = primaryField(fields);
  const imageField = photoField(fields);
  const stateField = statusField(fields);
  const title = titleField ? data[titleField.name] : record?.id;

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const entityRes = await mc.entities.list();
      const nextEntity = pickPrimaryEntity(entityRes.entities || []);
      if (!nextEntity) throw new Error("Schema dati non disponibile.");
      setEntity(nextEntity);
      const recordRes = await mc.data(nextEntity.name).get(id);
      setRecord(recordRes.record);
    } catch (err) {
      setError(err.message || "Non riesco a caricare il dettaglio.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleDelete() {
    if (!entity || !record) return;
    const ok = window.confirm(`Eliminare definitivamente "${title || PRIMARY_ENTITY_LABEL}"?`);
    if (!ok) return;
    setDeleting(true);
    setError(null);
    try {
      await mc.data(entity.name).delete(record.id);
      navigate("/", { replace: true });
    } catch (err) {
      setError(err.message || "Eliminazione non riuscita.");
    } finally {
      setDeleting(false);
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

  if (error && !record) {
    return (
      <div className="card p-6 border-rose-400/30 bg-rose-500/5 max-w-xl mx-auto">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-rose-300 mt-0.5" />
          <div>
            <h2 className="text-lg text-rose-100">Elemento non disponibile</h2>
            <p className="text-sm text-rose-200/80 mt-1">{error}</p>
            <Link to="/" className="btn-secondary btn-sm mt-4">Torna alla lista</Link>
          </div>
        </div>
      </div>
    );
  }

  const visibleFields = fields.filter((field) => field.name !== imageField?.name);

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-ink-100 transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        Torna alla lista
      </Link>

      <section className="card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-700/25 via-accent-500/10 to-transparent" />
        <div className="absolute inset-0 bg-grid opacity-25" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <Avatar
            fileId={imageField ? data[imageField.name] : null}
            name={String(title || PRIMARY_ENTITY_LABEL)}
            size="xl"
            ring
            className="flex-shrink-0"
          />
          <div className="flex-1 min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-accent-300 font-medium mb-2">
              {PRIMARY_ENTITY_LABEL}
            </p>
            <h1 className="text-gradient text-4xl sm:text-5xl leading-tight truncate">
              {title || "Senza titolo"}
            </h1>
            {stateField && data[stateField.name] && (
              <div className="mt-3">
                <StatusPill tone={statusTone(data[stateField.name])}>
                  <DisplayValue field={stateField} value={data[stateField.name]} />
                </StatusPill>
              </div>
            )}
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/r/${record.id}/edit`} className="btn-secondary">
              <Pencil className="w-4 h-4" />
              Modifica
            </Link>
            <button type="button" onClick={handleDelete} disabled={deleting} className="btn-danger">
              {deleting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
              Elimina
            </button>
          </div>
        </div>
      </section>

      {error && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-100">
          {error}
        </div>
      )}

      <section className="card p-6 sm:p-8">
        <h2 className="text-xl mb-5">Dettagli</h2>
        <dl className="grid sm:grid-cols-2 gap-4">
          {visibleFields.map((field) => (
            <div key={field.name} className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
              <dt className="text-xs uppercase tracking-wider text-ink-500 mb-2">{field.label}</dt>
              <dd className="text-sm text-ink-100 break-words">
                {field.kind === "file"
                  ? <DisplayValue field={field} value={data[field.name]} />
                  : formatValue(field, data[field.name])}
              </dd>
            </div>
          ))}
        </dl>
      </section>
    </div>
  );
}
