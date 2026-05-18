import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  Boxes,
  Calendar,
  Check,
  Copy,
  Database,
  ExternalLink,
  Files,
  Gauge,
  Hash,
  Loader2,
  ShieldCheck,
  Sparkles,
  Users,
} from "lucide-react";
import { tenants, tenantUrl, formatDateIt } from "../lib/api.js";
import { useToast } from "../components/Toast.jsx";

function planTone(plan) {
  if (plan === "trial") return "pill-warn";
  if (plan === "hosted") return "pill-accent";
  if (plan === "exported") return "pill-neutral";
  return "pill-neutral";
}

function InfoRow({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-white/[0.06] last:border-0">
      <Icon className="w-4 h-4 text-zinc-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">{label}</div>
        <div className={`text-sm text-zinc-100 break-words ${mono ? "font-mono" : ""}`}>
          {value || <span className="text-zinc-600">-</span>}
        </div>
      </div>
    </div>
  );
}

function formatCredits(value) {
  const n = Number(value || 0);
  if (n >= 1) return n.toFixed(2);
  if (n > 0) return n.toFixed(4).replace(/0+$/, "").replace(/\.$/, "");
  return "0";
}

function formatBytes(value) {
  const n = Number(value || 0);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function StatTile({ icon: Icon, label, value }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.025] p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
        <Icon className="w-4 h-4 text-accent-300" />
      </div>
      <div className="mt-2 font-display text-2xl font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

export default function AppDetailPage() {
  const { slug } = useParams();
  const toast = useToast();

  const [tenant, setTenant] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await tenants.list();
      const t = (res.tenants || []).find((x) => x.slug === slug);
      if (!t) {
        setError("App non trovata o non posseduta dal tuo account.");
        return;
      }

      setTenant(t);
      setStats(null);
      setStatsError(null);

      try {
        const statRes = await tenants.stats(t.id);
        setStats(statRes.stats);
      } catch (err) {
        setStatsError(err.message);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [slug]);

  async function copySlug() {
    if (!tenant) return;
    await navigator.clipboard.writeText(tenant.slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast.info("Slug copiato.");
  }

  if (error) {
    return (
      <div className="card p-6 border-rose-400/30 bg-rose-500/5 max-w-lg mx-auto">
        <p className="text-sm text-rose-200">{error}</p>
        <Link to="/" className="btn-secondary btn-sm mt-4">Torna alle app</Link>
      </div>
    );
  }

  if (!tenant) {
    return (
      <div className="grid place-items-center py-32 text-zinc-500 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
          Carico...
        </div>
      </div>
    );
  }

  const url = tenantUrl(tenant.slug);
  const aiCalls = stats ? stats.ai.callsSucceeded + stats.ai.callsFailed : 0;
  const aiPercent = stats?.ai.monthlyLimitCredits > 0
    ? Math.max(0, Math.min(100, (stats.ai.remainingCredits / stats.ai.monthlyLimitCredits) * 100))
    : 0;

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition">
        <ArrowLeft className="w-3.5 h-3.5" /> Tutte le app
      </Link>

      <div className="card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-700/35 via-accent-500/15 to-violet-500/20" />
        <div className="absolute inset-0 bg-grid opacity-25" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-900/80 to-transparent" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-400 to-violet-500 shadow-glow grid place-items-center text-white text-2xl font-bold ring-2 ring-accent-500/40 ring-offset-2 ring-offset-ink-900 flex-shrink-0">
            {tenant.name?.[0]?.toUpperCase() || "M"}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tighter2 text-white truncate drop-shadow">
              {tenant.name}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <span className={planTone(tenant.plan)}>{tenant.plan}</span>
              {tenant.status === "active" ? (
                <span className="pill-success">
                  <span className="pill-dot bg-emerald-400 text-emerald-400" /> attiva
                </span>
              ) : (
                <span className="pill-danger">
                  <span className="pill-dot bg-rose-400 text-rose-400" /> {tenant.status}
                </span>
              )}
              {tenant.publicRegistrationEnabled && (
                <span className="pill-neutral">
                  <ShieldCheck className="w-3 h-3" /> registrazione pubblica
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a href={url} target="_blank" rel="noreferrer" className="btn-primary">
              Apri l'app <ExternalLink className="w-4 h-4" />
            </a>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="card p-6 lg:col-span-3">
          <h2 className="text-sm font-medium text-zinc-400 mb-1 uppercase tracking-wider">Dati app</h2>
          <div className="mt-2">
            <InfoRow
              icon={Hash}
              label="Slug"
              value={(
                <span className="inline-flex items-center gap-2">
                  <code className="text-zinc-100">{tenant.slug}</code>
                  <button onClick={copySlug} className="btn-ghost btn-sm -ml-1">
                    {copied ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
              )}
            />
            <InfoRow
              icon={Boxes}
              label="URL pubblico"
              value={(
                <a href={url} target="_blank" rel="noreferrer" className="link">
                  https://mellucode.mellutecno.it{url}
                </a>
              )}
              mono
            />
            <InfoRow icon={Calendar} label="Creata il" value={formatDateIt(tenant.createdAt)} />
            <InfoRow icon={Hash} label="ID tenant" value={tenant.id} mono />
          </div>
        </div>

        <div className="lg:col-span-2 relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-500/40 via-accent-500/0 to-violet-500/30 rounded-2xl blur-md opacity-60 group-hover:opacity-100 transition" />
          <div className="relative card p-6 h-full flex flex-col">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-accent-400 to-violet-500 shadow-glow-sm">
                <Gauge className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-sm font-semibold text-white">Quota AI</h2>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Credito, consumo e chiamate AI di questa app. Il backend blocca automaticamente le chiamate quando il credito non basta.
            </p>

            {!stats && !statsError && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-accent-300" />
                Carico quota...
              </div>
            )}
            {statsError && (
              <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">
                {statsError}
              </div>
            )}
            {stats && (
              <div className="space-y-4">
                <div>
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="text-xs uppercase tracking-wider text-zinc-500">Credito residuo</span>
                    <span className="font-mono text-sm text-accent-200">
                      {formatCredits(stats.ai.remainingCredits)} / {formatCredits(stats.ai.monthlyLimitCredits)}
                    </span>
                  </div>
                  <div className="mt-2 h-2 rounded-full bg-white/[0.06] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-accent-400 to-cyan-200 shadow-glow-sm"
                      style={{ width: `${aiPercent}%` }}
                    />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <StatTile icon={Sparkles} label="Usato" value={formatCredits(stats.ai.usedThisPeriodCredits)} />
                  <StatTile icon={Activity} label="Chiamate" value={aiCalls} />
                </div>
                <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
                  <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">Token totali</p>
                  <p className="text-sm text-zinc-300 font-mono tabular-nums">{stats.ai.totalTokens}</p>
                </div>
              </div>
            )}

            <div className="flex-1" />
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                Powered by <span className="text-gradient-accent">MelluCode AI</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      {stats && (
        <div className="card p-6">
          <div className="flex items-center justify-between gap-4 mb-4">
            <div>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Metriche app</h2>
              <p className="text-xs text-zinc-500 mt-1">Dati reali salvati nel tenant MelluCode.</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <StatTile icon={Users} label="Utenti" value={stats.appUsers} />
            <StatTile icon={Database} label="Entita'" value={stats.entities} />
            <StatTile icon={Boxes} label="Record" value={stats.records} />
            <StatTile icon={Files} label="File" value={formatBytes(stats.files.sizeBytes)} />
          </div>
        </div>
      )}

      <div className="text-center pt-2">
        <code className="text-[10px] font-mono text-zinc-600">tenant - {tenant.id}</code>
      </div>
    </div>
  );
}
