// Home dashboard PREMIUM per le app generate da MelluCode.
// Disegnata a mano (no AI codegen). Si adatta automaticamente al dominio
// leggendo le entita' del tenant e scegliendo widget appropriati:
//   - statistiche: count per ogni entita'
//   - "in arrivo": entita' con campi date/datetime futuri
//   - "in scadenza": entita' con campi scadenza/expiry/expires
//   - "attivita' recente": ultimi 6 record creati globalmente
//   - "azioni rapide": "Aggiungi X" per le entita' principali
//
// Vincoli design (premium SaaS/AI tipo Lovable/Linear):
//   - hero con gradient + grano + spotlight
//   - tipografia grande, tracking tight
//   - card con glass + glow soft + hover lift
//   - micro animazioni (rise, fade-in, pulse-glow)
//   - palette tema dal tenant (gia' iniettata via Tailwind tokens)
//   - mai testo nudo "Loading..." -> skeleton sempre
//   - empty state illustrato + CTA chiara
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Sparkles, Plus, ArrowRight, Calendar, AlertTriangle, Clock,
  Users, Layers, TrendingUp, Activity, ChevronRight, Zap,
} from "lucide-react";
import { mc, APP_NAME, APP_SUBTITLE, entityRoute, entityNewRoute, recordRoute, formatDateIt, statusTone } from "../lib/api.js";

// ---------- helpers ----------

// Field "temporale": riconosce campi date/datetime/time anche solo dal nome.
function temporalFields(entity) {
  const props = entity?.schema?.properties || {};
  const out = [];
  for (const [name, def] of Object.entries(props)) {
    const fmt = def?.format;
    const n = name.toLowerCase();
    if (fmt === "date" || fmt === "date-time" || fmt === "time") out.push({ name, kind: fmt, def });
    else if (/(_at$|^data$|_data$|date|scadenza|expiry|expires|ora$|_ora$|_inizio$|_fine$|starts_at|ends_at)/.test(n)) {
      out.push({ name, kind: fmt || (n.includes("ora") || n.includes("time") ? "time" : "date"), def });
    }
  }
  return out;
}

// Field "scadenza": riconosce expiry/scadenza/expires nel nome.
function expiryFieldName(entity) {
  const props = entity?.schema?.properties || {};
  for (const name of Object.keys(props)) {
    if (/(scadenza|expiry|expires|valid_until|expire|due_date|expiration)/i.test(name)) return name;
  }
  return null;
}

// Field "status" enum: per badge tono.
function statusFieldName(entity) {
  const props = entity?.schema?.properties || {};
  for (const [name, def] of Object.entries(props)) {
    if (Array.isArray(def?.enum) && /(status|stato|state)/i.test(name)) return name;
  }
  return null;
}

// Nome leggibile principale del record (es. name, title, label).
function recordTitle(record, entity) {
  const data = record?.data || {};
  const props = entity?.schema?.properties || {};
  const preferred = ["name", "title", "label", "nome", "titolo", "cliente_nome", "user_name"];
  for (const key of preferred) {
    if (data[key]) return String(data[key]);
  }
  // Primo string field non-system
  for (const [k, def] of Object.entries(props)) {
    if (def?.type === "string" && !k.includes("_id") && !k.includes("file") && data[k]) {
      return String(data[k]).slice(0, 80);
    }
  }
  return "(senza nome)";
}

// Combina date + time in un Date js per ordinamento prossime.
function combineDateTime(data, dateField, timeField) {
  const d = data?.[dateField];
  const t = data?.[timeField];
  if (!d) return null;
  const iso = t ? `${d}T${String(t).slice(0, 5)}:00` : String(d);
  const x = new Date(iso);
  return Number.isNaN(x.getTime()) ? null : x;
}

function daysUntil(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  return Math.round((d.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

// Icona deterministica per entita' dal nome
function entityIcon(name = "") {
  const n = name.toLowerCase();
  if (/user|member|cliente|customer|iscritt|allievo|allievi|paziente|guest|invitati/i.test(n)) return Users;
  if (/session|booking|prenotaz|appuntament|event|corso|corsi/i.test(n)) return Calendar;
  if (/order|ordin|fattur|invoice|pagamento|payment/i.test(n)) return TrendingUp;
  if (/product|prodott|articolo|catalog|menu|piatti|gusto/i.test(n)) return Layers;
  if (/certif|document|allegato/i.test(n)) return AlertTriangle;
  if (/schedule|orario|orari|hour/i.test(n)) return Clock;
  return Activity;
}

// Tono palette per la "personalita'" del tile (deterministico dal nome)
const TONE_PALETTE = ["accent", "emerald", "amber", "violet", "rose", "cyan"];
function entityTone(name = "") {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return TONE_PALETTE[Math.abs(h) % TONE_PALETTE.length];
}

const TONE_CLS = {
  accent: {
    border: "border-accent-500/20", bg: "from-accent-500/15 to-accent-500/0", icon: "text-accent-300",
    glow: "shadow-glow-sm",
  },
  emerald: { border: "border-emerald-500/20", bg: "from-emerald-500/15 to-emerald-500/0", icon: "text-emerald-300", glow: "" },
  amber:   { border: "border-amber-500/20",   bg: "from-amber-500/15 to-amber-500/0",   icon: "text-amber-300",   glow: "" },
  violet:  { border: "border-violet-500/20",  bg: "from-violet-500/15 to-violet-500/0", icon: "text-violet-300",  glow: "" },
  rose:    { border: "border-rose-500/20",    bg: "from-rose-500/15 to-rose-500/0",     icon: "text-rose-300",    glow: "" },
  cyan:    { border: "border-cyan-500/20",    bg: "from-cyan-500/15 to-cyan-500/0",     icon: "text-cyan-300",    glow: "" },
};

// ---------- main ----------
export default function HomePage() {
  const [entities, setEntities] = useState(null);
  const [counts, setCounts] = useState({}); // entityName -> int
  const [samples, setSamples] = useState({}); // entityName -> [records]
  const [me, setMe] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [ent, who] = await Promise.all([
          mc.entities.list().catch(() => ({ entities: [] })),
          mc.auth.me().catch(() => ({ user: null })),
        ]);
        if (cancelled) return;
        const list = ent.entities || [];
        setEntities(list);
        setMe(who.user || null);

        // fetch samples paralleli (limit 8) per ogni entita'
        const results = await Promise.all(list.map(async (e) => {
          try {
            const res = await mc.data(e.name).list({ limit: 8 });
            return { name: e.name, records: res.records || [], total: res.total ?? (res.records?.length || 0) };
          } catch {
            return { name: e.name, records: [], total: 0 };
          }
        }));
        if (cancelled) return;
        const nextCounts = {};
        const nextSamples = {};
        for (const r of results) {
          nextCounts[r.name] = r.total;
          nextSamples[r.name] = r.records;
        }
        setCounts(nextCounts);
        setSamples(nextSamples);
      } catch (e) {
        if (!cancelled) setError(e.message || "Errore caricamento home.");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  // ---------- derived ----------

  // Stats tiles: prendi le top 4 entita' (per count desc) o se meno, tutte.
  const statTiles = useMemo(() => {
    if (!entities) return [];
    return [...entities]
      .map((e) => ({ entity: e, count: counts[e.name] ?? 0 }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 4);
  }, [entities, counts]);

  // Entita' con prossime date (futuro): metto le top 2 in sezione "in arrivo".
  const upcomingEntities = useMemo(() => {
    if (!entities) return [];
    const out = [];
    for (const e of entities) {
      const tfields = temporalFields(e);
      if (tfields.length === 0) continue;
      // Preferisci entity con date+time o date-time (eventi)
      const dateField = tfields.find((f) => f.kind === "date") || tfields.find((f) => f.kind === "date-time") || tfields[0];
      const timeField = tfields.find((f) => f.kind === "time" && f.name !== dateField.name);
      const records = samples[e.name] || [];
      const enriched = records
        .map((r) => ({ r, when: combineDateTime(r.data, dateField.name, timeField?.name) }))
        .filter((x) => x.when && x.when.getTime() >= Date.now() - 1000 * 60 * 60 * 24)
        .sort((a, b) => a.when - b.when)
        .slice(0, 4);
      if (enriched.length > 0) out.push({ entity: e, records: enriched, dateField, timeField });
    }
    return out.slice(0, 2);
  }, [entities, samples]);

  // Entita' con scadenze (expiry/scadenza): mostro alert in arrivo (30gg)
  const expiringList = useMemo(() => {
    if (!entities) return [];
    const out = [];
    for (const e of entities) {
      const fname = expiryFieldName(e);
      if (!fname) continue;
      const recs = samples[e.name] || [];
      for (const r of recs) {
        const v = r.data?.[fname];
        if (!v) continue;
        const days = daysUntil(v);
        if (days === null) continue;
        if (days <= 30) out.push({ entity: e, record: r, days, expiryFieldName: fname });
      }
    }
    return out
      .sort((a, b) => a.days - b.days)
      .slice(0, 4);
  }, [entities, samples]);

  // Activity recente: ultimi record creati globalmente (top 6 per createdAt)
  const recentActivity = useMemo(() => {
    if (!entities) return [];
    const all = [];
    for (const e of entities) {
      for (const r of samples[e.name] || []) {
        all.push({ entity: e, record: r, when: new Date(r.createdAt) });
      }
    }
    return all
      .filter((x) => !Number.isNaN(x.when.getTime()))
      .sort((a, b) => b.when - a.when)
      .slice(0, 6);
  }, [entities, samples]);

  // Quick actions: max 3 entita' primarie (la prima del catalogo + altre due)
  const quickActions = useMemo(() => {
    if (!entities) return [];
    return entities.slice(0, 3);
  }, [entities]);

  // ---------- render ----------

  if (loading) {
    return <HomeSkeleton />;
  }
  if (error) {
    return (
      <div className="card p-6 border-rose-400/30 bg-rose-500/5 max-w-2xl mx-auto">
        <p className="text-sm text-rose-200">{error}</p>
      </div>
    );
  }

  const isEmpty = (entities?.length || 0) === 0;

  return (
    <div className="space-y-8 animate-fade-in">
      {/* ---------- HERO ---------- */}
      <Hero user={me} />

      {!isEmpty && (
        <>
          {/* ---------- STATS ROW ---------- */}
          <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            {statTiles.map(({ entity, count }, idx) => (
              <StatTile key={entity.name} entity={entity} count={count} delay={idx * 60} />
            ))}
          </section>

          {/* ---------- MAIN 2 cols ---------- */}
          <div className="grid lg:grid-cols-3 gap-6">
            {/* Left: Upcoming (eventi/sessioni/appuntamenti) + Expiring */}
            <div className="lg:col-span-2 space-y-6">
              {upcomingEntities.map((bucket) => (
                <UpcomingCard key={bucket.entity.name} bucket={bucket} />
              ))}

              {expiringList.length > 0 && (
                <ExpiringCard items={expiringList} />
              )}

              {upcomingEntities.length === 0 && expiringList.length === 0 && (
                <FirstStepCard entities={entities} counts={counts} />
              )}
            </div>

            {/* Right: Activity recente + Quick actions */}
            <div className="space-y-6">
              <QuickActions entities={quickActions} />
              <RecentActivityCard items={recentActivity} />
            </div>
          </div>
        </>
      )}

      {isEmpty && (
        <div className="card p-10 text-center max-w-xl mx-auto">
          <Sparkles className="w-8 h-8 mx-auto text-accent-300 mb-4" />
          <h2 className="text-xl font-semibold text-white">L'app e' pronta, ma non ha ancora dati</h2>
          <p className="text-sm text-ink-300 mt-2 leading-relaxed">
            La struttura dati e' configurata. Inizia a inserire i primi record dalla console MelluCode
            o configura le entita' dell'app.
          </p>
        </div>
      )}
    </div>
  );
}

// ============================================================================
// ----- WIDGETS -----
// ============================================================================

function Hero({ user }) {
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Buongiorno";
    if (h < 19) return "Buon pomeriggio";
    return "Buonasera";
  }, []);
  const name = user?.name || user?.email?.split("@")[0] || "ciao";

  return (
    <section className="relative overflow-hidden rounded-3xl">
      {/* aurora bg */}
      <div className="absolute inset-0 -z-10">
        <div className="absolute -top-20 -left-20 w-[40rem] h-[40rem] bg-aurora-1 blur-[100px] opacity-90 animate-aurora" />
        <div className="absolute bottom-0 right-0 w-[24rem] h-[24rem] bg-aurora-2 blur-[80px] opacity-70 animate-aurora [animation-delay:-7s]" />
        <div className="absolute inset-0 bg-grid opacity-30" />
        <div className="absolute inset-0 bg-gradient-to-br from-ink-900/30 via-ink-900/40 to-ink-900/60" />
      </div>

      <div className="relative px-6 sm:px-10 py-10 sm:py-14">
        <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-ink-200 mb-5 animate-rise">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_currentColor]" />
          {greeting}, {name}
        </span>
        <h1 className="font-display text-4xl sm:text-5xl lg:text-6xl font-semibold tracking-tighter2 leading-[1.05] text-gradient max-w-3xl animate-rise [animation-delay:80ms]">
          {APP_NAME}
        </h1>
        {APP_SUBTITLE && (
          <p className="text-base sm:text-lg text-ink-300 mt-3 max-w-2xl leading-relaxed animate-rise [animation-delay:160ms]">
            {APP_SUBTITLE}
          </p>
        )}
      </div>
    </section>
  );
}

function StatTile({ entity, count, delay = 0 }) {
  const Icon = entityIcon(entity.name);
  const tone = entityTone(entity.name);
  const cls = TONE_CLS[tone];
  const label = entity.label || entity.name;
  return (
    <Link
      to={entityRoute(entity.name)}
      className={`card surface-hover p-5 relative overflow-hidden group animate-rise [animation-delay:${delay}ms]`}
      style={{ animationDelay: `${delay}ms` }}
    >
      <div className={`absolute inset-0 bg-gradient-to-br ${cls.bg} opacity-100 group-hover:opacity-150 transition`} />
      <div className="relative">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] uppercase tracking-wider text-ink-400 font-medium truncate max-w-[70%]" title={label}>
            {label}
          </span>
          <div className={`w-7 h-7 rounded-lg grid place-items-center bg-white/[0.04] border ${cls.border}`}>
            <Icon className={`w-3.5 h-3.5 ${cls.icon}`} />
          </div>
        </div>
        <div className="font-display text-3xl font-semibold tracking-tightish text-white tabular-nums">
          {count}
        </div>
        <div className="text-[11px] text-ink-400 mt-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition">
          Apri <ChevronRight className="w-3 h-3" />
        </div>
      </div>
    </Link>
  );
}

function UpcomingCard({ bucket }) {
  const { entity, records, dateField, timeField } = bucket;
  const Icon = entityIcon(entity.name);
  return (
    <section className="card p-6">
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-accent-500/20 to-accent-500/0 border border-accent-500/20 grid place-items-center shadow-glow-sm">
            <Icon className="w-4 h-4 text-accent-300" />
          </div>
          <div>
            <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">In arrivo</h2>
            <p className="text-base font-semibold text-white mt-0.5">{entity.label || entity.name}</p>
          </div>
        </div>
        <Link to={entityRoute(entity.name)} className="btn-ghost btn-sm">
          Vedi tutto <ArrowRight className="w-3.5 h-3.5" />
        </Link>
      </div>

      <ul className="divide-y divide-white/[0.05]">
        {records.map(({ r, when }, idx) => {
          const sname = statusFieldName(entity);
          const sval = sname ? r.data?.[sname] : null;
          const tone = sval ? statusTone(sval) : null;
          const days = Math.ceil((when.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
          const timeStr = timeField && r.data?.[timeField.name] ? String(r.data[timeField.name]).slice(0, 5) : null;
          return (
            <li key={r.id} className="py-3 first:pt-0 last:pb-0 animate-rise" style={{ animationDelay: `${idx * 40}ms` }}>
              <Link to={recordRoute(entity.name, r.id)} className="flex items-center gap-4 group">
                <DateBlock date={when} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate group-hover:text-accent-200 transition-colors">
                    {recordTitle(r, entity)}
                  </div>
                  <div className="flex items-center gap-2 mt-1 text-xs text-ink-400">
                    {timeStr && <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeStr}</span>}
                    {days === 0 && <span className="text-emerald-300">oggi</span>}
                    {days === 1 && <span className="text-accent-300">domani</span>}
                    {days > 1 && <span>fra {days} giorni</span>}
                    {sval && <span className={`pill-${tone === "emerald" ? "success" : tone === "amber" ? "warn" : tone === "rose" ? "danger" : "neutral"} !text-[10px] !py-0`}>{sval}</span>}
                  </div>
                </div>
                <ChevronRight className="w-4 h-4 text-ink-500 group-hover:text-accent-300 transition" />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function DateBlock({ date }) {
  const d = date.getDate();
  const m = date.toLocaleDateString("it-IT", { month: "short" }).toUpperCase().replace(".", "");
  return (
    <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-white/[0.05] to-white/[0.02] border border-white/[0.08] flex flex-col items-center justify-center flex-shrink-0">
      <span className="text-[10px] uppercase tracking-wider text-accent-300 font-semibold">{m}</span>
      <span className="text-base font-display font-semibold text-white tabular-nums leading-none">{d}</span>
    </div>
  );
}

function ExpiringCard({ items }) {
  return (
    <section className="card p-6 relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-amber-400/40 to-transparent" />
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-500/20 to-amber-500/0 border border-amber-500/30 grid place-items-center">
          <AlertTriangle className="w-4 h-4 text-amber-300" />
        </div>
        <div>
          <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">In scadenza</h2>
          <p className="text-base font-semibold text-white mt-0.5">Da rivedere a breve</p>
        </div>
      </div>
      <ul className="space-y-2">
        {items.map(({ entity, record, days, expiryFieldName }, idx) => {
          const tone = days < 0 ? "rose" : days <= 7 ? "amber" : "emerald";
          const bgCls = tone === "rose" ? "bg-rose-500/5 border-rose-400/20" : tone === "amber" ? "bg-amber-500/5 border-amber-400/20" : "bg-emerald-500/5 border-emerald-400/20";
          const dotCls = tone === "rose" ? "bg-rose-400 text-rose-400" : tone === "amber" ? "bg-amber-400 text-amber-400" : "bg-emerald-400 text-emerald-400";
          const label = days < 0 ? `scaduto da ${-days} g.` : days === 0 ? "oggi" : days === 1 ? "domani" : `fra ${days} giorni`;
          return (
            <li key={record.id} className="animate-rise" style={{ animationDelay: `${idx * 40}ms` }}>
              <Link to={recordRoute(entity.name, record.id)}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-xl border ${bgCls} hover:bg-opacity-80 group transition`}>
                <span className={`w-2 h-2 rounded-full ${dotCls} shadow-[0_0_8px_currentColor]`} />
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-white truncate">{recordTitle(record, entity)}</div>
                  <div className="text-[11px] text-ink-400 mt-0.5">
                    {entity.label || entity.name} · {formatDateIt(record.data?.[expiryFieldName])}
                  </div>
                </div>
                <span className={`text-[11px] font-medium ${tone === "rose" ? "text-rose-300" : tone === "amber" ? "text-amber-300" : "text-emerald-300"}`}>
                  {label}
                </span>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function QuickActions({ entities }) {
  if (!entities.length) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Zap className="w-4 h-4 text-accent-300" />
        <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Azioni rapide</h2>
      </div>
      <div className="space-y-2">
        {entities.map((e, idx) => (
          <Link key={e.name} to={entityNewRoute(e.name)}
            className="flex items-center gap-3 px-3 py-2.5 rounded-xl bg-white/[0.03] border border-white/[0.06] hover:bg-white/[0.06] hover:border-accent-500/30 group transition animate-rise"
            style={{ animationDelay: `${idx * 40}ms` }}>
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent-500/20 to-accent-500/0 border border-accent-500/30 grid place-items-center group-hover:shadow-glow-sm transition">
              <Plus className="w-3.5 h-3.5 text-accent-300" />
            </div>
            <span className="flex-1 text-sm text-ink-100">Aggiungi {(e.label || e.name).toLowerCase()}</span>
            <ChevronRight className="w-3.5 h-3.5 text-ink-500 group-hover:text-accent-300 transition" />
          </Link>
        ))}
      </div>
    </section>
  );
}

function RecentActivityCard({ items }) {
  if (!items.length) return null;
  return (
    <section className="card p-5">
      <div className="flex items-center gap-2 mb-4">
        <Activity className="w-4 h-4 text-cyan-300" />
        <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Attivita' recente</h2>
      </div>
      <ul className="space-y-3">
        {items.map(({ entity, record, when }, idx) => {
          const Icon = entityIcon(entity.name);
          return (
            <li key={record.id} className="animate-fade-in" style={{ animationDelay: `${idx * 30}ms` }}>
              <Link to={recordRoute(entity.name, record.id)} className="flex items-start gap-3 group">
                <div className="w-7 h-7 rounded-lg bg-white/[0.04] border border-white/[0.06] grid place-items-center flex-shrink-0 mt-0.5">
                  <Icon className="w-3 h-3 text-ink-300" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-white truncate group-hover:text-accent-200 transition">{recordTitle(record, entity)}</div>
                  <div className="text-[11px] text-ink-500 mt-0.5">
                    {entity.label || entity.name} · {relativeTime(when)}
                  </div>
                </div>
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function FirstStepCard({ entities, counts }) {
  // Nessun "in arrivo" ne "scadenze": probabilmente l'app e' nuova, mostra una guida.
  const empty = entities.filter((e) => (counts[e.name] || 0) === 0);
  return (
    <section className="card p-6">
      <div className="flex items-center gap-3 mb-4">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-cyan-500/20 to-cyan-500/0 border border-cyan-500/20 grid place-items-center">
          <Sparkles className="w-4 h-4 text-cyan-300" />
        </div>
        <div>
          <h2 className="text-sm font-medium text-ink-300 uppercase tracking-wider">Primi passi</h2>
          <p className="text-base font-semibold text-white mt-0.5">Popola le tabelle principali</p>
        </div>
      </div>
      <p className="text-sm text-ink-300 leading-relaxed mb-4">
        Per vedere prossime scadenze, eventi in arrivo e statistiche reali, inizia inserendo qualche record nelle aree dell'app.
      </p>
      <div className="flex flex-wrap gap-2">
        {empty.slice(0, 4).map((e) => (
          <Link key={e.name} to={entityNewRoute(e.name)} className="btn-secondary btn-sm">
            <Plus className="w-3.5 h-3.5" /> Aggiungi {(e.label || e.name).toLowerCase()}
          </Link>
        ))}
      </div>
    </section>
  );
}

// ---------- skeleton ----------
function HomeSkeleton() {
  return (
    <div className="space-y-8">
      <div className="card p-10 sm:p-14">
        <div className="skeleton h-5 w-40 mb-5" />
        <div className="skeleton h-12 w-2/3 mb-4" />
        <div className="skeleton h-4 w-1/2" />
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="card p-5">
            <div className="skeleton h-3 w-20 mb-3" />
            <div className="skeleton h-8 w-12" />
          </div>
        ))}
      </div>
      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 card p-6">
          <div className="skeleton h-5 w-32 mb-5" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="flex items-center gap-4 py-3 border-b border-white/5 last:border-0">
              <div className="skeleton w-12 h-12 rounded-xl" />
              <div className="flex-1 space-y-2">
                <div className="skeleton h-4 w-1/2" />
                <div className="skeleton h-3 w-1/3" />
              </div>
            </div>
          ))}
        </div>
        <div className="space-y-6">
          <div className="card p-5">
            <div className="skeleton h-5 w-32 mb-4" />
            <div className="space-y-2">
              {[0, 1, 2].map((i) => <div key={i} className="skeleton h-10 rounded-xl" />)}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function relativeTime(date) {
  const diff = Date.now() - date.getTime();
  const m = Math.round(diff / (1000 * 60));
  if (m < 1) return "adesso";
  if (m < 60) return `${m} min fa`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} ore fa`;
  const d = Math.round(h / 24);
  if (d < 30) return `${d} giorn${d === 1 ? "o" : "i"} fa`;
  return formatDateIt(date.toISOString());
}
