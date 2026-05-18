import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertCircle, ArrowRight, Database, Loader2, Plus, Search, Sparkles } from "lucide-react";
import { APP_LAYOUT, APP_NAME, APP_SUBTITLE, PRIMARY_ENTITY, entityNewRoute, recordRoute, mc, statusTone } from "../lib/api.js";
import Avatar from "../components/Avatar.jsx";
import EmptyState from "../components/EmptyState.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { MemberCardSkeleton } from "../components/Skeleton.jsx";
import { DisplayValue } from "../components/FieldRenderer.jsx";
import { getFields, photoField, previewFields, primaryField, statusField } from "../lib/entityIntrospect.js";

function pickEntity(entities, entityName) {
  return entities.find((e) => e.name === entityName) ||
    entities.find((e) => e.name === PRIMARY_ENTITY) ||
    entities.find((e) => e.metadata?.primary) ||
    entities[0] ||
    null;
}

function RecordCard({ entity, fields, record }) {
  const data = record.data || {};
  const titleField = primaryField(fields);
  const imageField = photoField(fields);
  const stateField = statusField(fields);
  const details = previewFields(fields, 3);
  const title = titleField ? data[titleField.name] : record.id;

  return (
    <Link to={recordRoute(entity.name, record.id)} className="record-card card surface-hover p-5 flex gap-4 group h-full">
      <Avatar
        fileId={imageField ? data[imageField.name] : null}
        name={String(title || entity.label || APP_NAME)}
        size="lg"
        ring
        className="flex-shrink-0"
      />
      <div className="min-w-0 flex-1">
        <div className="flex items-start gap-2">
          <h3 className="text-base font-semibold text-ink-100 truncate group-hover:text-accent-200 transition">
            {title || "Senza titolo"}
          </h3>
          <ArrowRight className="w-4 h-4 text-accent-300 opacity-0 group-hover:opacity-100 transition mt-0.5 flex-shrink-0" />
        </div>
        {stateField && data[stateField.name] && (
          <div className="mt-2">
            <StatusPill tone={statusTone(data[stateField.name])}>
              <DisplayValue field={stateField} value={data[stateField.name]} />
            </StatusPill>
          </div>
        )}
        <dl className="mt-3 space-y-1.5">
          {details.map((field) => (
            <div key={field.name} className="grid grid-cols-[7rem_1fr] gap-2 text-xs">
              <dt className="text-ink-500 truncate">{field.label}</dt>
              <dd className="text-ink-300 truncate">
                <DisplayValue field={field} value={data[field.name]} />
              </dd>
            </div>
          ))}
        </dl>
      </div>
    </Link>
  );
}

export default function EntityListPage() {
  const { entityName } = useParams();
  const [entities, setEntities] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  const entity = useMemo(() => entities ? pickEntity(entities, entityName) : null, [entities, entityName]);
  const fields = useMemo(() => getFields(entity), [entity]);

  async function load() {
    setError(null);
    try {
      const entityRes = await mc.entities.list();
      const nextEntities = entityRes.entities || [];
      setEntities(nextEntities);

      const nextEntity = pickEntity(nextEntities, entityName);
      if (!nextEntity) {
        setRecords([]);
        return;
      }

      const dataRes = await mc.data(nextEntity.name).list({ limit: 100 });
      setRecords(dataRes.records || []);
    } catch (err) {
      setError(err.message || "Non riesco a caricare i dati.");
    }
  }

  useEffect(() => { load(); }, [entityName]);

  const filtered = useMemo(() => {
    if (!records) return null;
    const needle = q.trim().toLowerCase();
    if (!needle) return records;
    return records.filter((record) => JSON.stringify(record.data || {}).toLowerCase().includes(needle));
  }, [records, q]);

  if (error) {
    return (
      <div className="card p-6 border-rose-400/30 bg-rose-500/5 max-w-xl mx-auto">
        <div className="flex gap-3">
          <AlertCircle className="w-5 h-5 text-rose-300 mt-0.5" />
          <div>
            <h2 className="text-lg text-rose-100">Qualcosa non va</h2>
            <p className="text-sm text-rose-200/80 mt-1">{error}</p>
            <button onClick={load} className="btn-secondary btn-sm mt-4">Riprova</button>
          </div>
        </div>
      </div>
    );
  }

  const loading = entities === null || records === null;

  return (
    <div className="space-y-8">
      <section className="app-hero relative overflow-hidden rounded-[2rem] border border-white/[0.06] bg-ink-900/65 p-6 sm:p-9 shadow-card">
        <div className="absolute inset-0 bg-grid opacity-25" />
        <div className="absolute -top-24 -right-16 w-80 h-80 bg-aurora-1 blur-[90px] opacity-80" />
        <div className="relative flex flex-col md:flex-row md:items-end md:justify-between gap-6">
          <div className="max-w-2xl">
            <p className="text-xs uppercase tracking-[0.18em] text-accent-300 font-medium mb-3">
              {APP_LAYOUT === "agenda" ? "Agenda operativa" : APP_LAYOUT === "commerce" ? "Catalogo e ordini" : APP_NAME}
            </p>
            <h1 className="text-gradient text-4xl sm:text-5xl leading-tight">
              {entity?.metadata?.labelPlural || entity?.label || "Dati"}
            </h1>
            <p className="text-ink-300 mt-3 leading-relaxed">
              {APP_SUBTITLE || `Gestisci ${(entity?.label || "i dati").toLowerCase()} in modo semplice, veloce e ordinato.`}
            </p>
          </div>
          {entity && (
            <Link to={entityNewRoute(entity.name)} className="btn-primary btn-lg self-start md:self-end">
              <Plus className="w-4 h-4" />
              Nuovo {(entity.label || "elemento").toLowerCase()}
            </Link>
          )}
        </div>
      </section>

      {!loading && !entity && (
        <EmptyState
          title="App quasi pronta"
          description="Lo schema dati non e' ancora disponibile. Torna alla Console MelluCode e genera prima lo schema dell'app."
        />
      )}

      {entity && (
        <>
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
              <input
                className="input pl-10"
                placeholder="Cerca..."
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div className="flex items-center gap-2 text-xs text-ink-500">
              <Database className="w-3.5 h-3.5" />
              {filtered ? `${filtered.length} risultati` : "Carico dati"}
            </div>
          </div>

          {loading && (
            <div className="grid md:grid-cols-2 gap-4">
              <MemberCardSkeleton />
              <MemberCardSkeleton />
              <MemberCardSkeleton />
              <MemberCardSkeleton />
            </div>
          )}

          {!loading && filtered?.length === 0 && (
            <EmptyState
              title={q ? "Nessun risultato" : `Nessun ${(entity.label || "elemento").toLowerCase()} ancora`}
              description={q ? "Prova con un'altra ricerca." : "Aggiungi il primo elemento e inizia a usare l'app."}
              cta={!q ? `Aggiungi ${(entity.label || "elemento").toLowerCase()}` : null}
              to={!q ? entityNewRoute(entity.name) : null}
            />
          )}

          {!loading && filtered?.length > 0 && (
            <div className="records-grid grid md:grid-cols-2 gap-4">
              {filtered.map((record) => (
                <RecordCard key={record.id} entity={entity} fields={fields} record={record} />
              ))}
            </div>
          )}
        </>
      )}

      {loading && (
        <div className="flex justify-center py-4 text-ink-500 text-sm">
          <Loader2 className="w-4 h-4 animate-spin mr-2 text-accent-300" />
          Carico...
        </div>
      )}
    </div>
  );
}
