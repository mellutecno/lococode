import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ArrowLeft, ExternalLink, Loader2, Copy, Check, Boxes, Calendar, Hash,
  ShieldCheck, Sparkles,
} from "lucide-react";
import { tenants, tenantUrl, formatDateIt } from "../lib/api.js";
import { useToast } from "../components/Toast.jsx";

function planTone(plan) {
  if (plan === "trial")   return "pill-warn";
  if (plan === "hosted")  return "pill-accent";
  if (plan === "exported")return "pill-neutral";
  return "pill-neutral";
}

function InfoRow({ icon: Icon, label, value, mono = false }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-white/[0.06] last:border-0">
      <Icon className="w-4 h-4 text-zinc-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">{label}</div>
        <div className={`text-sm text-zinc-100 break-words ${mono ? "font-mono" : ""}`}>
          {value || <span className="text-zinc-600">—</span>}
        </div>
      </div>
    </div>
  );
}

export default function AppDetailPage() {
  const { slug } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [tenant, setTenant] = useState(null);
  const [error, setError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    // Niente endpoint /v1/tenants/:slug ancora — pesca dalla lista.
    try {
      const res = await tenants.list();
      const t = (res.tenants || []).find((x) => x.slug === slug);
      if (!t) {
        setError("App non trovata o non posseduta dal tuo account.");
        return;
      }
      setTenant(t);
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
        <Link to="/" className="btn-secondary btn-sm mt-4">← Torna alle app</Link>
      </div>
    );
  }
  if (!tenant) {
    return (
      <div className="grid place-items-center py-32 text-zinc-500 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
          Carico…
        </div>
      </div>
    );
  }

  const url = tenantUrl(tenant.slug);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition">
        <ArrowLeft className="w-3.5 h-3.5" /> Tutte le app
      </Link>

      {/* ---------- HERO ---------- */}
      <div className="card overflow-hidden">
        <div className="relative h-28 sm:h-32 bg-gradient-to-br from-accent-700/50 via-accent-500/40 to-violet-500/30">
          <div className="absolute inset-0 bg-grid opacity-30" />
          <div className="absolute inset-0 bg-gradient-to-t from-ink-900 to-transparent" />
        </div>
        <div className="px-6 sm:px-8 pb-6 -mt-14 sm:-mt-16">
          <div className="flex flex-col sm:flex-row sm:items-end gap-5">
            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-accent-400 to-violet-500 shadow-glow grid place-items-center text-white text-2xl font-bold ring-2 ring-accent-500/40 ring-offset-2 ring-offset-ink-900 flex-shrink-0">
              {tenant.name?.[0]?.toUpperCase() || "·"}
            </div>
            <div className="flex-1 min-w-0 sm:pb-2">
              <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tighter2 text-white truncate">
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
            <div className="flex items-center gap-2 sm:pb-2">
              <a href={url} target="_blank" rel="noreferrer" className="btn-primary">
                Apri l'app <ExternalLink className="w-4 h-4" />
              </a>
            </div>
          </div>
        </div>
      </div>

      {/* ---------- INFO + AI panel ---------- */}
      <div className="grid lg:grid-cols-5 gap-6">
        <div className="card p-6 lg:col-span-3">
          <h2 className="text-sm font-medium text-zinc-400 mb-1 uppercase tracking-wider">Dati app</h2>
          <div className="mt-2">
            <InfoRow icon={Hash}     label="Slug"
                     value={
                       <span className="inline-flex items-center gap-2">
                         <code className="text-zinc-100">{tenant.slug}</code>
                         <button onClick={copySlug} className="btn-ghost btn-sm -ml-1">
                           {copied ? <Check className="w-3 h-3 text-emerald-400" />
                                   : <Copy className="w-3 h-3" />}
                         </button>
                       </span>
                     } />
            <InfoRow icon={Boxes}    label="URL pubblico"
                     value={<a href={url} target="_blank" rel="noreferrer" className="link">
                       https://mellucode.mellutecno.it{url}
                     </a>} mono />
            <InfoRow icon={Calendar} label="Creata il" value={formatDateIt(tenant.createdAt)} />
            <InfoRow icon={Hash}     label="ID tenant" value={tenant.id} mono />
          </div>
        </div>

        {/* ---------- AI placeholder panel ---------- */}
        <div className="lg:col-span-2 relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-500/40 via-accent-500/0 to-violet-500/30 rounded-2xl blur-md opacity-60 group-hover:opacity-100 transition" />
          <div className="relative card p-6 h-full flex flex-col">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-accent-400 to-violet-500 shadow-glow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-sm font-semibold text-white">Frontend AI</h2>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Presto: descrivi a parole come deve essere la tua app e l'AI
              generera' frontend + schema dati a partire dai template MelluCode.
            </p>
            <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5">
              <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1.5">In arrivo · Fase 2</p>
              <p className="text-sm text-zinc-300 leading-relaxed">
                Per ora l'app e' un tenant vuoto. Usa l'API a basso livello
                o aspetta il prompt-to-app generator.
              </p>
            </div>
            <div className="flex-1" />
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                Powered by <span className="text-gradient-accent">MelluCode AI</span>
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center pt-2">
        <code className="text-[10px] font-mono text-zinc-600">tenant · {tenant.id}</code>
      </div>
    </div>
  );
}
