// Lista records premium per le app generate da MelluCode.
// Disegnata a mano (no AI codegen). Si adatta al dominio leggendo i field
// dell'entita': se c'e' un campo enum status -> filter chips, se c'e' un
// campo foto -> avatar grande, se c'e' un campo data -> tile data, etc.
//
// Layout:
//   - Breadcrumb compatto (Home > Nome entita')
//   - Header con titolo gradient + count + bottone primary "Aggiungi"
//   - Stats mini bar (se ci sono status enum, breakdown count per status)
//   - Toolbar: search + filter chips status + sort
//   - Card grandi con avatar/foto + primary + 2-3 meta lines + status pill
//   - Empty state illustrato + skeleton
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  AlertCircle, ArrowLeft, ArrowRight, ChevronRight, Database, Loader2, Plus,
  Search, Filter, ArrowDownUp, Calendar, Clock, Tag, X,
} from "lucide-react";
import {
  APP_NAME, PRIMARY_ENTITY, entityNewRoute, recordRoute, mc, statusTone,
} from "../lib/api.js";
import Avatar from "../components/Avatar.jsx";
import EmptyState from "../components/EmptyState.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { DisplayValue } from "../components/FieldRenderer.jsx";
import {
  getFields, photoField, previewFields, primaryField, statusField, formatValue,
} from "../lib/entityIntrospect.js";

// ---------- helpers ----------

function pickEntity(entities, entityName) {
  return entities.find((e) => e.name === entityName) ||
    entities.find((e) => e.name === PRIMARY_ENTITY) ||
    entities.find((e) => e.metadata?.primary) ||
    entities[0] ||
    null;
}

// Field temporale (data/datetime) per ordinamento e tile data.
function temporalField(fields) {
  return fields.find((f) => f.kind === "datetime") ||
         fields.find((f) => f.kind === "date") ||
         null;
}

function recordTimestamp(record) {
  const t = record?.createdAt;
  if (!t) return null;
  const d = new Date(t);
  return Number.isNaN(d.getTime()) ? null : d;
}

function relativeTime(date) {
  if (!date) return "";
  const diff = Date.now() - date.getTime();
  const m = Math.round(diff / (1000 * 60));
  if (m < 1) return "adesso";
  if (m < 60) return `${m}min`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d}g`;
  return date.toLocaleDateString("it-IT", { day: "2-digit", month: "short" });
}

const STATUS_TONE_CLS = {
  emerald: "bg-emerald-500/10 text-emerald-300 border-emerald-400/30",
  amber:   "bg-amber-500/10 text-amber-300 border-amber-400/30",
  rose:    "bg-rose-500/10 text-rose-300 border-rose-400/30",
  neutral: "bg-white/[0.05] text-ink-300 border-white/[0.08]",
};

// ---------- card ----------

function RecordCard({ entity, fields, record, statusByField, dateByField }) {
  const data = record.data || {};
  const titleField = primaryField(fields);
  const imageField = photoField(fields);
  const stateField = statusByField;
  const dateField = dateByField;

  // 2-3 meta secondari (escludo title, image, status, date gia' usati altrove)
  const details = previewFields(fields, 6).filter((f) =>
    f.name !== titleField?.name &&
    f.name !== imageField?.name &&
    f.name !== stateField?.name &&
    f.name !== dateField?.name &&
    f.kind !== "file" && f.kind !== "json"
  ).slice(0, 3);

  const title = titleField ? data[titleField.name] : record.id;
  const created = recordTimestamp(record);

  return (
    <Link
      to={recordRoute(entity.name, record.id)}
      className="group relative card surface-hover p-5 sm:p-6 overflow-hidden block animate-rise"
    >
      {/* hover glow underlay */}
      <div className="absolute inset-0 bg-gradient-to-br from-accent-500/0 to-accent-500/0 group-hover:from-accent-500/[0.04] transition-colors pointer-events-none" />

      <div className="relative flex gap-4 sm:gap-5">
        <Avatar
          fileId={imageField ? data[imageField.name] : null}
          name={String(title || entity.label || APP_NAME)}
          size="lg"
          ring
          className="flex-shrink-0"
        />

        <div className="flex-1 min-w-0">
          {/* primary line */}
          <div className="flex items-start gap-2">
            <h3 className="text-base sm:text-lg font-semibold text-ink-100 truncate group-hover:text-accent-200 transition-colors">
              {title || "Senza titolo"}
            </h3>
            <ArrowRight className="w-4 h-4 text-accent-300 opacity-0 group-hover:opacity-100 transition mt-1 flex-shrink-0" />
          </div>

          {/* status + date */}
          {(stateField || dateField) && (
            <div className="flex flex-wrap items-center gap-2 mt-1.5">
              {stateField && data[stateField.name] && (
                <StatusPill tone={statusTone(data[stateField.name])}>
                  <DisplayValue field={stateField} value={data[stateField.name]} />
                </StatusPill>
              )}
              {dateField && data[dateField.name] && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-400">
                  <Calendar className="w-3 h-3" />
                  {formatValue(dateField, data[dateField.name])}
                </span>
              )}
              {created && !dateField && (
                <span className="inline-flex items-center gap-1 text-xs text-ink-500">
                  <Clock className="w-3 h-3" />
                  {relativeTime(created)} fa
                </span>
              )}
            </div>
          )}

          {/* meta lines */}
          {details.length > 0 && (
            <dl className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5">
              {details.map((field) => {
                const v = data[field.name];
                if (v === undefined || v === null || v === "") return null;
                return (
                  <div key={field.name} className="text-xs truncate">
                    <span className="text-ink-500">{field.label}: </span>
                    <span className="text-ink-300">{formatValue(field, v)}</span>
                  </div>
                );
              })}
            </dl>
          )}
        </div>
      </div>
    </Link>
  );
}

// ---------- main ----------

export default function EntityListPage() {
  const { entityName } = useParams();
  const [entities, setEntities] = useState(null);
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [activeStatus, setActiveStatus] = useState(null); // valore enum status selezionato come filtro
  const [sortMode, setSortMode] = useState("recent"); // recent | oldest | a-z

  const entity = useMemo(() => entities ? pickEntity(entities, entityName) : null, [entities, entityName]);
  const fields = useMemo(() => getFields(entity), [entity]);
  const stateField = useMemo(() => statusField(fields), [fields]);
  const dateField = useMemo(() => temporalField(fields), [fields]);
  const titleField = useMemo(() => primaryField(fields), [fields]);

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

  useEffect(() => { load(); setQ(""); setActiveStatus(null); }, [entityName]);

  // Status breakdown per stat row mini (count per ogni valore enum)
  const statusCounts = useMemo(() => {
    if (!records || !stateField?.enum) return null;
    const counts = {};
    for (const v of stateField.enum) counts[v] = 0;
    for (const r of records) {
      const v = r.data?.[stateField.name];
      if (v && counts[v] !== undefined) counts[v]++;
    }
    return counts;
  }, [records, stateField]);

  // Filtra + ordina
  const filtered = useMemo(() => {
    if (!records) return null;
    let list = records;

    if (activeStatus && stateField) {
      list = list.filter((r) => r.data?.[stateField.name] === activeStatus);
    }

    const needle = q.trim().toLowerCase();
    if (needle) {
      list = list.filter((r) => JSON.stringify(r.data || {}).toLowerCase().includes(needle));
    }

    const sorted = [...list];
    if (sortMode === "recent") {
      sorted.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortMode === "oldest") {
      sorted.sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    } else if (sortMode === "a-z" && titleField) {
      sorted.sort((a, b) => {
        const at = String(a.data?.[titleField.name] || "").toLowerCase();
        const bt = String(b.data?.[titleField.name] || "").toLowerCase();
        return at.localeCompare(bt, "it");
      });
    }

    return sorted;
  }, [records, q, activeStatus, sortMode, stateField, titleField]);

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
  const totalCount = records?.length ?? 0;
  const filteredCount = filtered?.length ?? 0;

  return (
    <div className="space-y-7 animate-fade-in">
      {/* ---------- BREADCRUMB ---------- */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-ink-400 hover:text-accent-200 transition">
        <ArrowLeft className="w-3.5 h-3.5" />
        Home
      </Link>

      {/* ---------- HERO COMPATTO ---------- */}
      <section className="relative overflow-hidden rounded-2xl">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-32 -left-20 w-[40rem] h-[40rem] bg-aurora-1 blur-[100px] opacity-60 animate-aurora" />
          <div className="absolute inset-0 bg-grid opacity-25" />
          <div className="absolute inset-0 bg-gradient-to-b from-transparent to-ink-900/40" />
        </div>

        <div className="relative px-5 sm:px-7 py-7 sm:py-9 flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.18em] text-accent-300 font-medium mb-2">
              {entity?.metadata?.section || "Sezione"}
            </p>
            <h1 className="font-display text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tighter2 text-gradient leading-tight">
              {entity?.metadata?.labelPlural || entity?.label || "Dati"}
            </h1>
            {!loading && (
              <p className="text-sm text-ink-300 mt-2">
                {totalCount === 0
                  ? `Nessun elemento ancora`
                  : totalCount === 1
                    ? `1 elemento totale`
                    : `${totalCount} elementi totali`}
                {activeStatus && filteredCount !== totalCount && (
                  <span className="text-ink-400"> · filtrati {filteredCount}</span>
                )}
              </p>
            )}
          </div>
          {entity && (
            <Link to={entityNewRoute(entity.name)} className="btn-primary self-start sm:self-end shrink-0">
              <Plus className="w-4 h-4" />
              Aggiungi {(entity.label || "elemento").toLowerCase()}
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
          {/* ---------- STATUS BREAKDOWN ---------- */}
          {statusCounts && totalCount > 0 && (
            <section className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <StatusFilterTile
                label="Tutti"
                count={totalCount}
                active={activeStatus === null}
                onClick={() => setActiveStatus(null)}
                tone="accent"
              />
              {stateField.enum.slice(0, 3).map((value) => (
                <StatusFilterTile
                  key={value}
                  label={value}
                  count={statusCounts[value] || 0}
                  active={activeStatus === value}
                  onClick={() => setActiveStatus(activeStatus === value ? null : value)}
                  tone={statusTone(value)}
                />
              ))}
            </section>
          )}

          {/* ---------- TOOLBAR ---------- */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-500" />
              <input
                className="input pl-10 pr-10"
                placeholder={`Cerca in ${(entity.label || "elementi").toLowerCase()}...`}
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
              {q && (
                <button
                  onClick={() => setQ("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 rounded-full bg-white/[0.06] hover:bg-white/[0.12] grid place-items-center transition"
                  aria-label="Pulisci ricerca"
                >
                  <X className="w-3 h-3 text-ink-300" />
                </button>
              )}
            </div>
            <div className="flex items-center gap-2 flex-wrap">
              <SortMenu mode={sortMode} setMode={setSortMode} hasTitle={!!titleField} />
              {(activeStatus || q) && (
                <button
                  onClick={() => { setActiveStatus(null); setQ(""); }}
                  className="btn-ghost btn-sm"
                >
                  <X className="w-3.5 h-3.5" /> Reset filtri
                </button>
              )}
              {filtered && (
                <div className="hidden sm:flex items-center gap-2 text-xs text-ink-500 ml-auto">
                  <Database className="w-3.5 h-3.5" />
                  {filteredCount} {filteredCount === 1 ? "risultato" : "risultati"}
                </div>
              )}
            </div>
          </div>

          {/* ---------- LISTA ---------- */}
          {loading && (
            <div className="grid md:grid-cols-2 gap-4">
              {[0, 1, 2, 3].map((i) => <RecordCardSkeleton key={i} delay={i * 60} />)}
            </div>
          )}

          {!loading && filteredCount === 0 && (
            <EmptyState
              title={q || activeStatus
                ? "Nessun risultato"
                : `Nessun ${(entity.label || "elemento").toLowerCase()} ancora`}
              description={q || activeStatus
                ? "Cambia ricerca o filtri per vedere altri risultati."
                : "Aggiungi il primo elemento e inizia a usare l'app."}
              cta={!q && !activeStatus ? `Aggiungi ${(entity.label || "elemento").toLowerCase()}` : null}
              to={!q && !activeStatus ? entityNewRoute(entity.name) : null}
            />
          )}

          {!loading && filteredCount > 0 && (
            <div className="grid md:grid-cols-2 gap-4">
              {filtered.map((record) => (
                <RecordCard
                  key={record.id}
                  entity={entity}
                  fields={fields}
                  record={record}
                  statusByField={stateField}
                  dateByField={dateField}
                />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ---------- sub-components ----------

function StatusFilterTile({ label, count, active, onClick, tone = "neutral" }) {
  const cls = STATUS_TONE_CLS[tone] || STATUS_TONE_CLS.neutral;
  return (
    <button
      onClick={onClick}
      className={`relative card surface-hover p-4 text-left overflow-hidden transition ${active ? "!border-accent-500/50 shadow-glow-sm" : ""}`}
    >
      <div className={`absolute inset-0 bg-gradient-to-br opacity-30 transition-opacity ${active ? "opacity-100" : ""} ${cls.split(" ")[0]} to-transparent`} />
      <div className="relative">
        <div className="flex items-center justify-between gap-2 mb-1">
          <span className={`text-[10px] uppercase tracking-wider font-semibold truncate ${active ? "text-accent-200" : "text-ink-400"}`}>
            {label}
          </span>
          {active && <span className="w-1.5 h-1.5 rounded-full bg-accent-400 shadow-[0_0_8px_currentColor]" />}
        </div>
        <div className="font-display text-2xl font-semibold text-white tabular-nums">{count}</div>
      </div>
    </button>
  );
}

function SortMenu({ mode, setMode, hasTitle }) {
  const [open, setOpen] = useState(false);
  const options = [
    { id: "recent", label: "Piu' recenti" },
    { id: "oldest", label: "Piu' vecchi" },
  ];
  if (hasTitle) options.push({ id: "a-z", label: "Alfabetico A-Z" });
  const current = options.find((o) => o.id === mode) || options[0];

  return (
    <div className="relative">
      <button onClick={() => setOpen(!open)} className="btn-secondary btn-sm">
        <ArrowDownUp className="w-3.5 h-3.5" />
        {current.label}
        <ChevronRight className={`w-3 h-3 transition ${open ? "rotate-90" : ""}`} />
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute right-0 top-full mt-1 z-20 glass rounded-xl shadow-card overflow-hidden min-w-[180px] animate-scale-in">
            {options.map((o) => (
              <button
                key={o.id}
                onClick={() => { setMode(o.id); setOpen(false); }}
                className={`w-full px-4 py-2.5 text-left text-sm transition hover:bg-white/[0.06] ${o.id === mode ? "text-accent-200 bg-white/[0.04]" : "text-ink-200"}`}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function RecordCardSkeleton({ delay = 0 }) {
  return (
    <div className="card p-5 sm:p-6 animate-rise" style={{ animationDelay: `${delay}ms` }}>
      <div className="flex gap-4">
        <div className="skeleton w-16 h-16 rounded-2xl flex-shrink-0" />
        <div className="flex-1 space-y-2.5">
          <div className="skeleton h-5 w-1/2" />
          <div className="skeleton h-4 w-1/3" />
          <div className="skeleton h-3 w-2/3 mt-2" />
          <div className="skeleton h-3 w-1/2" />
        </div>
      </div>
    </div>
  );
}
