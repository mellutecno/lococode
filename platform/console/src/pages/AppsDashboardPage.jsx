import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import {
  Plus, ExternalLink, Boxes, CheckCircle2, Loader2, Search, Sparkles,
  ArrowRight, Shield, AlertCircle,
} from "lucide-react";
import { tenants, formatDateIt, slugifyClient, tenantUrl } from "../lib/api.js";
import { AppCardSkeleton, StatCardSkeleton } from "../components/Skeleton.jsx";
import EmptyState from "../components/EmptyState.jsx";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";

function StatCard({ icon: Icon, label, value, tone = "accent" }) {
  const toneCls = {
    accent:  "from-accent-500/30 to-accent-500/0 text-accent-300",
    neutral: "from-zinc-500/30 to-zinc-500/0 text-zinc-300",
    success: "from-emerald-500/30 to-emerald-500/0 text-emerald-300",
  }[tone];
  return (
    <div className="card surface-hover p-5 relative overflow-hidden">
      <div className={`absolute inset-x-0 top-0 h-px bg-gradient-to-r ${toneCls}`} />
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
        <Icon className={`w-4 h-4 ${toneCls.split(" ").pop()}`} />
      </div>
      <div className="font-display text-3xl font-semibold tracking-tightish text-white tabular-nums">{value}</div>
    </div>
  );
}

function planTone(plan) {
  if (plan === "trial")   return "pill-warn";
  if (plan === "hosted")  return "pill-accent";
  if (plan === "exported")return "pill-neutral";
  return "pill-neutral";
}

function CreateAppForm({ onCreated, onClose }) {
  const toast = useToast();
  const [name, setName] = useState("");
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [adminEmail, setAdminEmail] = useState("");
  const [adminPassword, setAdminPassword] = useState("");
  const [publicReg, setPublicReg] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  function onNameChange(v) {
    setName(v);
    if (!slugTouched) setSlug(slugifyClient(v));
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      const payload = {
        name: name.trim(),
        slug: slug.trim() || slugifyClient(name),
        publicRegistrationEnabled: publicReg,
      };
      if (adminEmail.trim() && adminPassword) {
        payload.adminEmail = adminEmail.trim();
        payload.adminPassword = adminPassword;
      }
      const res = await tenants.create(payload);
      toast.success(`App "${res.tenant.name}" creata.`);
      onCreated?.(res);
      onClose?.();
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div className="field">
        <label className="label">Nome app *</label>
        <input
          className="input" required maxLength={160}
          value={name} onChange={(e) => onNameChange(e.target.value)}
          placeholder="Es. Studio Mellucci, Cantina del Sole, …"
        />
      </div>

      <div className="field">
        <label className="label">Slug (URL)</label>
        <div className="relative">
          <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm font-mono">
            /apps/
          </span>
          <input
            className="input pl-[4.4rem] font-mono"
            value={slug}
            onChange={(e) => { setSlug(slugifyClient(e.target.value)); setSlugTouched(true); }}
            placeholder="studio-mellucci"
            minLength={2} maxLength={80}
            pattern="[a-z0-9-]+"
          />
        </div>
        <div className="help">Solo lettere minuscole, numeri e trattini. Generato automaticamente dal nome.</div>
      </div>

      <details className="rounded-xl border border-white/[0.06] bg-white/[0.02] open:bg-white/[0.04] transition">
        <summary className="cursor-pointer select-none px-4 py-3 text-sm text-zinc-300 flex items-center gap-2">
          <Shield className="w-3.5 h-3.5 text-accent-300" />
          Configura admin iniziale dell'app (opzionale)
        </summary>
        <div className="px-4 pb-4 pt-1 space-y-4">
          <div className="field">
            <label className="label">Email admin app</label>
            <input
              className="input" type="email" maxLength={320}
              value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)}
              placeholder="admin@tua-app.it"
            />
            <div className="help">Account amministratore degli utenti finali (non il tuo account MelluCode).</div>
          </div>
          <div className="field">
            <label className="label">Password admin app</label>
            <input
              className="input" type="password" minLength={8} maxLength={200}
              value={adminPassword} onChange={(e) => setAdminPassword(e.target.value)}
              placeholder="Almeno 8 caratteri"
            />
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input type="checkbox" checked={publicReg} onChange={(e) => setPublicReg(e.target.checked)}
                   className="rounded accent-accent-500" />
            Permetti la registrazione pubblica utenti
          </label>
        </div>
      </details>

      {error && (
        <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/20 text-sm text-rose-200">
          {error}
        </div>
      )}

      <div className="sticky bottom-0 -mx-5 sm:-mx-6 -mb-5 px-5 sm:px-6 py-4 border-t border-white/[0.06] bg-ink-900/95 backdrop-blur-xl flex items-center justify-end gap-2">
        <button type="button" onClick={onClose} className="btn-ghost">Annulla</button>
        <button type="submit" disabled={busy} className="btn-primary">
          {busy ? <><Loader2 className="w-4 h-4 animate-spin" /> Creo…</>
                : <><Sparkles className="w-4 h-4" /> Crea app</>}
        </button>
      </div>
    </form>
  );
}

export default function AppsDashboardPage({ user }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);

  async function load() {
    try {
      const res = await tenants.list();
      setList(res.tenants || []);
    } catch (err) {
      setError(err.message);
    }
  }
  useEffect(() => { load(); }, []);

  const stats = useMemo(() => {
    if (!list) return null;
    const active = list.filter((t) => t.status === "active").length;
    const trial  = list.filter((t) => t.plan === "trial").length;
    return { total: list.length, active, trial };
  }, [list]);

  const filtered = useMemo(() => {
    if (!list) return null;
    if (!q.trim()) return list;
    const n = q.trim().toLowerCase();
    return list.filter((t) =>
      (t.name || "").toLowerCase().includes(n) ||
      (t.slug || "").toLowerCase().includes(n)
    );
  }, [list, q]);

  return (
    <div className="space-y-8">
      {/* ---------- HEADER ---------- */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-[0.16em] text-accent-400/80 font-medium mb-2">
            Console MelluCode
          </p>
          <h1 className="font-display text-4xl font-semibold tracking-tighter2 text-gradient">
            Le tue app
          </h1>
          <p className="text-sm text-zinc-400 mt-2 max-w-xl">
            Ogni app e' un tenant isolato sul backend MelluCode: utenti, dati, file e
            quota AI sono separati. Crea quante app vuoi.
          </p>
        </div>
        <button onClick={() => setCreateOpen(true)} className="btn-primary self-start sm:self-end">
          <Plus className="w-4 h-4" /> Nuova app
        </button>
      </div>

      {/* ---------- STATS ---------- */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        {!stats ? (
          <><StatCardSkeleton /><StatCardSkeleton /><StatCardSkeleton /></>
        ) : (
          <>
            <StatCard icon={Boxes}         label="App totali" value={stats.total} tone="accent" />
            <StatCard icon={CheckCircle2}  label="Attive"     value={stats.active} tone="success" />
            <StatCard icon={Sparkles}      label="In trial"   value={stats.trial} tone="neutral" />
          </>
        )}
      </div>

      <div className="accent-divider" />

      {/* ---------- SEARCH ---------- */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
          <input
            className="input pl-10"
            placeholder="Cerca per nome o slug…"
            value={q} onChange={(e) => setQ(e.target.value)}
          />
        </div>
        {list && (
          <span className="text-xs text-zinc-500 hidden sm:inline tabular-nums">
            {filtered?.length} / {list.length}
          </span>
        )}
      </div>

      {/* ---------- ERROR ---------- */}
      {error && (
        <div className="card p-5 border-rose-400/30 bg-rose-500/5 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-rose-300 mt-0.5" />
          <div>
            <p className="text-sm text-rose-100 font-medium">Errore di caricamento</p>
            <p className="text-sm text-rose-200/80 mt-0.5">{error}</p>
          </div>
        </div>
      )}

      {/* ---------- LIST ---------- */}
      {list === null && !error && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          <AppCardSkeleton /><AppCardSkeleton /><AppCardSkeleton />
          <AppCardSkeleton /><AppCardSkeleton /><AppCardSkeleton />
        </ul>
      )}

      {list?.length === 0 && (
        <EmptyState
          title="Ancora nessuna app"
          description="Crea la tua prima app MelluCode. Ti consegniamo un backend isolato con auth, dati e file pronti. Tu metti il frontend (o lo facciamo noi con AI in arrivo)."
          action={
            <button onClick={() => setCreateOpen(true)} className="btn-primary">
              <Plus className="w-4 h-4" /> Crea la prima
            </button>
          }
        />
      )}

      {filtered && filtered.length === 0 && list?.length > 0 && (
        <div className="card p-10 text-center">
          <Search className="w-6 h-6 mx-auto text-zinc-500 mb-3" />
          <p className="text-sm text-zinc-300">Nessun risultato per "<span className="text-white">{q}</span>".</p>
          <button onClick={() => setQ("")} className="link text-sm mt-2">Resetta la ricerca</button>
        </div>
      )}

      {filtered && filtered.length > 0 && (
        <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((t) => (
            <li key={t.id} className="animate-fade-in">
              <Link
                to={`/app/${t.slug}`}
                className="card surface-hover p-5 flex flex-col gap-3 h-full group"
              >
                <div className="flex items-start justify-between gap-2">
                  <h3 className="font-semibold text-white truncate group-hover:text-accent-200 transition-colors">
                    {t.name}
                  </h3>
                  <span className={planTone(t.plan)}>
                    {t.plan}
                  </span>
                </div>
                <p className="text-xs text-zinc-500 font-mono truncate">/apps/{t.slug}/</p>

                <div className="flex items-center gap-2 mt-auto pt-3 border-t border-white/[0.04]">
                  {t.status === "active" ? (
                    <span className="pill-success !text-[10px]">
                      <span className="pill-dot bg-emerald-400 text-emerald-400" /> attiva
                    </span>
                  ) : (
                    <span className="pill-danger !text-[10px]">
                      <span className="pill-dot bg-rose-400 text-rose-400" /> {t.status}
                    </span>
                  )}
                  <span className="text-[10px] text-zinc-500 ml-auto">
                    {formatDateIt(t.createdAt)}
                  </span>
                </div>

                <div className="flex items-center justify-between -mx-1">
                  <a
                    href={tenantUrl(t.slug)} target="_blank" rel="noreferrer"
                    onClick={(e) => e.stopPropagation()}
                    className="btn-ghost btn-sm"
                  >
                    Apri <ExternalLink className="w-3 h-3" />
                  </a>
                  <span className="text-accent-300 text-xs opacity-0 group-hover:opacity-100 transition flex items-center gap-1">
                    Dettagli <ArrowRight className="w-3 h-3" />
                  </span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}

      {/* ---------- CREATE MODAL ---------- */}
      <Modal
        open={createOpen}
        onClose={() => setCreateOpen(false)}
        title="Crea una nuova app"
        subtitle="Un tenant isolato sul backend MelluCode, pronto in pochi secondi."
        maxWidth="xl"
      >
        <CreateAppForm
          onCreated={() => load()}
          onClose={() => setCreateOpen(false)}
        />
      </Modal>
    </div>
  );
}
