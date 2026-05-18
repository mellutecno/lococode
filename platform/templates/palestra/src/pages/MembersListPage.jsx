import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Plus, Search, TrendingUp, AlertCircle, XCircle, Users2 } from "lucide-react";
import { mc, MEMBERS_ENTITY, subscriptionStatus, subscriptionTypeLabel, computeStats, formatDateIt } from "../lib/api.js";
import Avatar from "../components/Avatar.jsx";
import StatusPill from "../components/StatusPill.jsx";
import EmptyState from "../components/EmptyState.jsx";
import { MemberCardSkeleton, StatCardSkeleton } from "../components/Skeleton.jsx";

function StatCard({ icon: Icon, label, value, tone = "neutral", trend }) {
  const toneCls = {
    accent:  "from-accent-500/30 to-accent-500/0 text-accent-300",
    success: "from-emerald-500/30 to-emerald-500/0 text-emerald-300",
    warn:    "from-amber-500/30 to-amber-500/0 text-amber-300",
    danger:  "from-rose-500/30 to-rose-500/0 text-rose-300",
    neutral: "from-zinc-500/20 to-zinc-500/0 text-zinc-300",
  }[tone];
  return (
    <div className="card surface-hover p-5 relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${toneCls}`} />
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${toneCls.split(' ').pop()}`} />
      </div>
      <div className="flex items-baseline gap-2">
        <div className="font-display text-3xl font-semibold tracking-tightish text-white tabular-nums">{value}</div>
        {trend && <div className="text-xs text-zinc-500">{trend}</div>}
      </div>
    </div>
  );
}

export default function MembersListPage() {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");

  async function load() {
    try {
      const res = await mc.data(MEMBERS_ENTITY).list({ limit: 100 });
      setRecords(res.records || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  const stats = useMemo(() => computeStats(records || []), [records]);
  const filtered = useMemo(() => {
    if (!records) return null;
    if (!q.trim()) return records;
    const needle = q.trim().toLowerCase();
    return records.filter((r) => {
      const d = r.data || {};
      return [d.name, d.email, d.phone].some((v) => (v || "").toLowerCase().includes(needle));
    });
  }, [records, q]);

  return (
    <div className="space-y-8">
      {/* ---------- Header ---------- */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-accent-400/80 font-medium mb-2">Dashboard</p>
          <h1 className="font-display text-4xl font-semibold tracking-tighter2 text-gradient">Membri</h1>
          <p className="text-sm text-zinc-400 mt-2">
            Gestisci abbonati, abbonamenti e foto profilo. Tutto sincronizzato sul backend.
          </p>
        </div>
        <Link to="/new" className="btn-primary self-start sm:self-end">
          <Plus className="w-4 h-4" /> Nuovo membro
        </Link>
      </div>

      {/* ---------- Stats ---------- */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {records === null ? (
          <>
            <StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard icon={Users2} label="Totale membri" value={stats.total} tone="accent" />
            <StatCard icon={TrendingUp} label="Attivi" value={stats.active} tone="success" />
            <StatCard icon={AlertCircle} label="In scadenza" value={stats.expiring} tone="warn"
                      trend={stats.expiring > 0 ? "≤ 14 giorni" : null} />
            <StatCard icon={XCircle} label="Scaduti" value={stats.expired} tone="danger" />
          </>
        )}
      </div>

      <div className="accent-divider" />

      {/* ---------- Search ---------- */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            className="input pl-10"
            placeholder="Cerca per nome, email, telefono…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {records && (
          <span className="text-xs text-zinc-500 hidden sm:inline tabular-nums">
            {filtered?.length} / {records.length}
          </span>
        )}
      </div>

      {/* ---------- Body ---------- */}
      {error && (
        <div className="card p-5 border-rose-400/30 bg-rose-500/5">
          <p className="text-sm text-rose-200">{error}</p>
        </div>
      )}

      {records === null && !error && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <MemberCardSkeleton /><MemberCardSkeleton /><MemberCardSkeleton />
          <MemberCardSkeleton /><MemberCardSkeleton /><MemberCardSkeleton />
        </ul>
      )}

      {records?.length === 0 && (
        <EmptyState
          title="Ancora nessun membro"
          description="Aggiungi il tuo primo membro per iniziare. Potrai associarlo a un abbonamento, caricare la foto profilo e generare messaggi personalizzati."
          cta={<><Plus className="w-4 h-4" /> Aggiungi il primo</>}
          to="/new"
        />
      )}

      {filtered && filtered.length === 0 && records?.length > 0 && (
        <div className="card p-10 text-center">
          <Search className="w-6 h-6 mx-auto text-zinc-500 mb-3" />
          <p className="text-sm text-zinc-300">Nessun risultato per "<span className="text-white">{q}</span>".</p>
          <button onClick={() => setQ("")} className="link text-sm mt-2">Resetta la ricerca</button>
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((r) => {
            const m = r.data || {};
            const s = subscriptionStatus(m.subscription_until);
            return (
              <li key={r.id} className="animate-fade-in">
                <Link
                  to={`/m/${r.id}`}
                  className="card surface-hover p-5 flex gap-4 items-start group"
                >
                  <Avatar fileId={m.photo_file_id} name={m.name} size="md" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <h3 className="font-semibold text-white truncate group-hover:text-accent-200 transition-colors">
                        {m.name || "(senza nome)"}
                      </h3>
                    </div>
                    <p className="text-xs text-zinc-500 truncate mt-0.5">{m.email || m.phone || "—"}</p>
                    <div className="flex items-center gap-2 mt-3">
                      <StatusPill tone={s.tone}>{s.label}</StatusPill>
                      <span className="text-[10px] uppercase tracking-wider text-zinc-500">
                        {subscriptionTypeLabel(m.subscription_type)}
                      </span>
                    </div>
                    <p className="text-[11px] text-zinc-600 mt-2">
                      fino al <span className="text-zinc-400">{formatDateIt(m.subscription_until)}</span>
                    </p>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
