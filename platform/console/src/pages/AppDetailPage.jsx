import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router-dom";
import {
  Activity,
  ArrowLeft,
  AlertTriangle,
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
  MonitorUp,
  Pencil,
  Rocket,
  Save,
  ShieldCheck,
  Sparkles,
  Trash2,
  Users,
} from "lucide-react";
import { tenants, tenantUrl, formatDateIt, slugifyClient } from "../lib/api.js";
import Modal from "../components/Modal.jsx";
import AppIcon from "../components/AppIcon.jsx";
import RevisionChat from "../components/RevisionChat.jsx";
import AppAdminCard from "../components/AppAdminCard.jsx";
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const toast = useToast();

  const [tenant, setTenant] = useState(null);
  const [stats, setStats] = useState(null);
  const [error, setError] = useState(null);
  const [statsError, setStatsError] = useState(null);
  const [copied, setCopied] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [editName, setEditName] = useState("");
  const [editSlug, setEditSlug] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [editPublicReg, setEditPublicReg] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [formError, setFormError] = useState(null);
  const [generating, setGenerating] = useState(false);
  const [frontendGenerating, setFrontendGenerating] = useState(false);
  const [buildStage, setBuildStage] = useState("idle");
  const [buildMessages, setBuildMessages] = useState([]);
  const [autoBuildStarted, setAutoBuildStarted] = useState(false);
  const [genResult, setGenResult] = useState(null);
  const [activeBuildId, setActiveBuildId] = useState(null);
  const [buildProgress, setBuildProgress] = useState(0);
  const pollTimerRef = useRef(null);

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
        setTenant(statRes.tenant);
        setStats(statRes.stats);
      } catch (err) {
        setStatsError(err.message);
      }
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [slug]);

  useEffect(() => {
    if (!tenant || autoBuildStarted || searchParams.get("build") !== "1") return;
    setAutoBuildStarted(true);
    setSearchParams({}, { replace: true });
    handleBuildApp();
  }, [tenant, autoBuildStarted, searchParams, setSearchParams]);

  async function copySlug() {
    if (!tenant) return;
    await navigator.clipboard.writeText(tenant.slug);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
    toast.info("Indirizzo copiato.");
  }

  function openEdit() {
    setEditName(tenant.name || "");
    setEditSlug(tenant.slug || "");
    setEditPrompt(tenant.metadata?.initialPrompt || "");
    setEditPublicReg(Boolean(tenant.publicRegistrationEnabled));
    setFormError(null);
    setEditOpen(true);
  }

  async function saveEdit(e) {
    e.preventDefault();
    if (!tenant) return;
    setSaving(true);
    setFormError(null);
    try {
      const res = await tenants.update(tenant.id, {
        name: editName.trim(),
        slug: slugifyClient(editSlug),
        initialPrompt: editPrompt.trim(),
        publicRegistrationEnabled: editPublicReg,
      });
      setTenant(res.tenant);
      setEditOpen(false);
      toast.success("App aggiornata.");
      if (res.tenant.slug !== slug) navigate(`/app/${res.tenant.slug}`, { replace: true });
    } catch (err) {
      setFormError(err.message);
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  }

  async function deleteApp() {
    if (!tenant) return;
    setDeleting(true);
    setFormError(null);
    try {
      await tenants.delete(tenant.id);
      toast.success(`App "${tenant.name}" eliminata.`);
      navigate("/", { replace: true });
    } catch (err) {
      setFormError(err.message);
      toast.error(err.message);
    } finally {
      setDeleting(false);
    }
  }

  async function handleGenerateSchema() {
    if (!tenant) return;
    setGenerating(true);
    try {
      const res = await tenants.generateSchema(tenant.id);
      setGenResult(res);
      toast.success(`${res.created} tabelle dati generate.`);
      // Refresh stats so entity count updates
      const statRes = await tenants.stats(tenant.id);
      setTenant(statRes.tenant);
      setStats(statRes.stats);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  }

  async function handleGenerateFrontend() {
    if (!tenant) return;
    setFrontendGenerating(true);
    try {
      const res = await tenants.generateFrontend(tenant.id);
      setTenant(res.tenant);
      toast.success("Frontend generato e pubblicato.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setFrontendGenerating(false);
    }
  }

  function pushBuildMessage(message) {
    setBuildMessages((prev) => [...prev.slice(-4), message]);
  }

  // ---------- Pipeline build asincrona (polling) ----------
  // Il server esegue schema + frontend in background e aggiorna mc_app_builds.
  // La Console fa polling ogni 2 secondi su getBuild(buildId) finche' lo stato
  // diventa succeeded o failed, poi ricarica tenant + stats per la preview.
  function stopPolling() {
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  }

  function applyBuildSnapshot(b) {
    if (!b) return;
    if (b.stage) setBuildStage(b.stage);
    if (typeof b.progress === "number") setBuildProgress(b.progress);
    if (Array.isArray(b.messages)) {
      setBuildMessages(b.messages.map((m) => (typeof m === "string" ? m : m.text)));
    }
  }

  async function pollOnce(buildId) {
    try {
      const res = await tenants.getBuild(tenant.id, buildId);
      const b = res?.build;
      applyBuildSnapshot(b);

      if (b?.status === "succeeded") {
        stopPolling();
        setGenerating(false);
        setFrontendGenerating(false);
        setActiveBuildId(null);
        const statRes = await tenants.stats(tenant.id);
        setTenant(statRes.tenant);
        setStats(statRes.stats);
        toast.success("App pronta!");
      } else if (b?.status === "failed") {
        stopPolling();
        setGenerating(false);
        setFrontendGenerating(false);
        setActiveBuildId(null);
        toast.error(b.errorMessage || "Build fallita.");
      }
    } catch (err) {
      // Rete giu' o errore transitorio: non stoppiamo, riprova al prossimo tick.
      // Solo se il build e' sparito (404) stoppiamo.
      if (err?.status === 404) {
        stopPolling();
        setGenerating(false);
        setFrontendGenerating(false);
        setActiveBuildId(null);
      }
    }
  }

  function startPolling(buildId) {
    stopPolling();
    setActiveBuildId(buildId);
    // Primo poll immediato, poi ogni 2s
    pollOnce(buildId);
    pollTimerRef.current = setInterval(() => pollOnce(buildId), 2000);
  }

  async function handleBuildApp() {
    if (!tenant) return;
    setGenerating(true);
    setFrontendGenerating(true);
    setBuildStage("queued");
    setBuildProgress(0);
    setBuildMessages([]);

    try {
      const res = await tenants.startBuild(tenant.id);
      if (res?.conflict) {
        // Era gia' un build attivo: riprendi polling su quello.
        toast.info("Ripresa build in corso.");
      }
      startPolling(res.build.id);
    } catch (err) {
      setBuildStage("error");
      setBuildMessages([err.message]);
      setGenerating(false);
      setFrontendGenerating(false);
      toast.error(err.message);
    }
  }

  // Cleanup polling su unmount (cambio pagina) o cambio tenant.
  useEffect(() => () => stopPolling(), []);
  useEffect(() => { stopPolling(); }, [slug]);

  // Al mount, se c'e' gia' un build attivo per questo tenant (es. utente ha
  // refreshato la pagina mentre la build girava), riprendi il polling.
  useEffect(() => {
    if (!tenant?.id || activeBuildId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await tenants.listBuilds(tenant.id, { limit: 1 });
        const last = res?.builds?.[0];
        if (!cancelled && last && (last.status === "queued" || last.status === "running")) {
          setGenerating(true);
          setFrontendGenerating(true);
          applyBuildSnapshot(last);
          startPolling(last.id);
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [tenant?.id]);

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
  const frontend = tenant.metadata?.frontend || null;
  const publicUrl = frontend?.url || url;
  const canOpenApp = Boolean(frontend?.url);
  const isBuilding = ["queued", "running", "schema", "frontend"].includes(buildStage);
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
          <AppIcon size="lg" className="flex-shrink-0" />
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
            <button type="button" onClick={openEdit} className="btn-secondary">
              <Pencil className="w-4 h-4" /> Modifica
            </button>
            {canOpenApp ? (
              <a href={publicUrl} target="_blank" rel="noreferrer" className="btn-primary">
                Apri l'app <ExternalLink className="w-4 h-4" />
              </a>
            ) : (
              <button type="button" disabled className="btn-secondary">
                In costruzione
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6 items-start">
        <section className="card p-6 lg:col-span-3">
          <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
            <div>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Costruzione app</h2>
              <p className="text-sm text-zinc-300 mt-2 max-w-2xl">
                MelluCode prepara la struttura, costruisce l'interfaccia e pubblica una preview reale sul tuo link.
              </p>
            </div>
            <button
              type="button"
              onClick={handleBuildApp}
              disabled={isBuilding}
              className="btn-primary shrink-0"
            >
              {isBuilding ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
              {isBuilding ? " Sto lavorando..." : frontend?.url ? " Aggiorna app" : " Costruisci app"}
            </button>
          </div>

          <div className="grid sm:grid-cols-3 gap-3 mt-5">
            <div className={`rounded-xl border p-3 ${buildStage === "schema" ? "border-accent-400/50 bg-accent-500/10" : stats?.entities ? "border-emerald-400/25 bg-emerald-500/10" : "border-white/[0.06] bg-white/[0.02]"}`}>
              <p className="text-xs uppercase tracking-wider text-zinc-500">1. Struttura</p>
              <p className="text-sm text-zinc-100 mt-1">{stats?.entities ? "Pronta" : "Da preparare"}</p>
            </div>
            <div className={`rounded-xl border p-3 ${buildStage === "frontend" ? "border-accent-400/50 bg-accent-500/10" : frontend?.url ? "border-emerald-400/25 bg-emerald-500/10" : "border-white/[0.06] bg-white/[0.02]"}`}>
              <p className="text-xs uppercase tracking-wider text-zinc-500">2. Interfaccia</p>
              <p className="text-sm text-zinc-100 mt-1">{frontend?.url ? "Pubblicata" : "Da creare"}</p>
            </div>
            <div className={`rounded-xl border p-3 ${frontend?.url ? "border-emerald-400/25 bg-emerald-500/10" : "border-white/[0.06] bg-white/[0.02]"}`}>
              <p className="text-xs uppercase tracking-wider text-zinc-500">3. Preview</p>
              <p className="text-sm text-zinc-100 mt-1">{frontend?.url ? "Disponibile" : "In attesa"}</p>
            </div>
          </div>

          <div className="mt-5 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 min-h-[96px]">
            {buildMessages.length > 0 ? (
              <div className="space-y-2">
                {buildMessages.map((m, idx) => (
                  <p key={`${m}-${idx}`} className="text-sm text-zinc-300 flex gap-2">
                    <span className="mt-2 w-1.5 h-1.5 rounded-full bg-accent-300 shadow-[0_0_8px_currentColor] shrink-0" />
                    <span>{m}</span>
                  </p>
                ))}
              </div>
            ) : (
              <p className="text-sm text-zinc-500">
                Premi Costruisci app: qui vedrai i passaggi principali, senza dettagli tecnici inutili.
              </p>
            )}
          </div>
        </section>

        <section className="card p-5 lg:col-span-2">
          <div className="flex items-center justify-between gap-3 mb-4">
            <div>
              <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Preview</h2>
              <p className="text-xs text-zinc-500 mt-1">La tua app appena diventa navigabile.</p>
            </div>
            {frontend?.url && (
              <a href={frontend.url} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
                Apri <ExternalLink className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          {frontend?.url ? (
            <div className="rounded-2xl overflow-hidden border border-white/[0.08] bg-white">
              <iframe
                title={`Preview ${tenant.name}`}
                src={frontend.url}
                className="w-full h-[460px] bg-white"
              />
            </div>
          ) : (
            <div className="grid place-items-center rounded-2xl border border-dashed border-white/[0.10] bg-white/[0.02] h-[320px] text-center p-6">
              <div>
                {isBuilding ? (
                  <Loader2 className="w-6 h-6 animate-spin text-accent-300 mx-auto mb-3" />
                ) : (
                  <MonitorUp className="w-6 h-6 text-zinc-500 mx-auto mb-3" />
                )}
                <p className="text-sm text-zinc-300 font-medium">
                  {isBuilding ? "Sto preparando la preview..." : "La preview comparira' appena possibile."}
                </p>
                <p className="text-xs text-zinc-500 mt-1">
                  Quando la pubblicazione finisce, la vedrai direttamente qui.
                </p>
              </div>
            </div>
          )}
        </section>
      </div>

      {/* Accesso admin app: visibile sempre, anche su app appena creata.
          Risolve la confusione "non so se sono admin dell'app" — l'app
          generata ha auth separata dal MelluCode account. */}
      {(stats?.entities > 0 || tenant.metadata?.frontend?.url) && (
        <section>
          <AppAdminCard tenant={tenant} />
        </section>
      )}

      {/* Chat modifiche AI: visibile solo dopo che lo schema esiste,
          cosi' l'utente non vede una chat inutile su un'app vuota. */}
      {(stats?.entities > 0 || tenant.metadata?.frontend?.url) && (
        <section>
          <RevisionChat
            tenantId={tenant.id}
            disabled={isBuilding}
            onRevisionSent={({ buildId }) => {
              if (buildId) {
                setGenerating(true);
                setFrontendGenerating(true);
                setBuildStage("queued");
                setBuildMessages([]);
                startPolling(buildId);
              }
            }}
          />
        </section>
      )}

      <div className="grid lg:grid-cols-5 gap-6">
        <div className="card p-6 lg:col-span-3">
          <h2 className="text-sm font-medium text-zinc-400 mb-1 uppercase tracking-wider">Dati app</h2>
          <div className="mt-2">
            <InfoRow
              icon={Hash}
              label="Indirizzo breve"
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
              label="Link pubblico"
              value={(
                <a href={url} target="_blank" rel="noreferrer" className="link">
                  https://mellucode.mellutecno.it{url}
                </a>
              )}
              mono
            />
            <InfoRow icon={Calendar} label="Creata il" value={formatDateIt(tenant.createdAt)} />
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
              Credito e utilizzo AI di questa app. Quando il credito finisce, le funzioni AI si fermano automaticamente.
            </p>

            {!stats && !statsError && (
              <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4 text-sm text-zinc-400 flex items-center gap-2">
                <Loader2 className="w-4 h-4 animate-spin text-accent-300" />
                Carico credito...
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
              <p className="text-xs text-zinc-500 mt-1">Panoramica dei dati e dei contenuti collegati a questa app.</p>
            </div>
          </div>
          <div className="grid sm:grid-cols-4 gap-3">
            <StatTile icon={Users} label="Utenti" value={stats.appUsers} />
            <StatTile icon={Database} label="Tabelle dati" value={stats.entities} />
            <StatTile icon={Boxes} label="Record" value={stats.records} />
            <StatTile icon={Files} label="File" value={formatBytes(stats.files.sizeBytes)} />
          </div>
        </div>
      )}

      <div className="card p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Struttura dati</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Se serve, puoi rigenerare solo la struttura senza pubblicare subito la preview.
            </p>
          </div>
          <button
            type="button"
            onClick={handleGenerateSchema}
            disabled={generating}
            className="btn-primary"
          >
            {generating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {generating ? " Genero..." : " Rigenera struttura"}
          </button>
        </div>

        {tenant.metadata?.initialPrompt && (
          <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-3.5 mb-4">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500 mb-1">Richiesta iniziale</p>
            <p className="text-sm text-zinc-300">{tenant.metadata.initialPrompt}</p>
          </div>
        )}

        {genResult && (
          <div className="space-y-2">
            {genResult.entities?.map((e) => (
              <div key={e.id} className="flex items-center gap-2 text-sm text-zinc-200">
                <Database className="w-4 h-4 text-accent-400" />
                {e.label} <code className="text-zinc-500 text-xs">({e.name})</code>
              </div>
            ))}
            {genResult.errors?.length > 0 && (
              <div className="text-xs text-rose-300 mt-2">
                {genResult.errors.length} entità non valide ignorate.
              </div>
            )}
          </div>
        )}
      </div>

      <div className="card p-6">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-zinc-400 uppercase tracking-wider">Pubblicazione</h2>
            <p className="text-xs text-zinc-500 mt-1">
              Se hai gia' una struttura pronta, puoi aggiornare solo il frontend pubblicato.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {frontend?.url && (
              <a href={frontend.url} target="_blank" rel="noreferrer" className="btn-secondary">
                <ExternalLink className="w-4 h-4" /> Apri frontend
              </a>
            )}
            <button
              type="button"
              onClick={handleGenerateFrontend}
              disabled={frontendGenerating || !stats?.entities}
              className="btn-primary"
            >
              {frontendGenerating ? <Loader2 className="w-4 h-4 animate-spin" /> : <Rocket className="w-4 h-4" />}
              {frontendGenerating ? " Pubblico..." : frontend?.url ? " Rigenera frontend" : " Genera frontend"}
            </button>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          {frontend?.url ? (
            <div className="flex flex-col sm:flex-row sm:items-center gap-3 text-sm text-zinc-300">
              <MonitorUp className="w-4 h-4 text-accent-300 flex-shrink-0" />
              <span className="flex-1">
                Pubblicato su <a href={frontend.url} target="_blank" rel="noreferrer" className="link">{frontend.url}</a>
              </span>
              {frontend.generatedAt && (
                <span className="text-xs text-zinc-500">aggiornato {formatDateIt(frontend.generatedAt)}</span>
              )}
            </div>
          ) : (
            <p className="text-sm text-zinc-400">
              La pubblicazione viene fatta automaticamente dal pulsante Costruisci app. Questo comando resta come controllo manuale.
            </p>
          )}
        </div>
      </div>

      <div className="card p-6 border-rose-400/20 bg-rose-500/[0.03]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div>
            <h2 className="text-sm font-medium text-rose-100 uppercase tracking-wider">Zona pericolosa</h2>
            <p className="text-sm text-zinc-400 mt-1">
              Elimina questa app solo se non ti serve piu. L'operazione rimuove anche dati e file collegati.
            </p>
          </div>
          <button type="button" onClick={() => { setFormError(null); setDeleteOpen(true); }} className="btn-danger">
            <Trash2 className="w-4 h-4" /> Elimina app
          </button>
        </div>
      </div>

      <Modal
        open={editOpen}
        onClose={() => setEditOpen(false)}
        title="Modifica app"
        subtitle="Cambia nome, indirizzo pubblico e accesso degli utenti."
        maxWidth="lg"
      >
        <form onSubmit={saveEdit} className="space-y-5">
          <div className="field">
            <label className="label">Nome app</label>
            <input
              className="input"
              required
              minLength={2}
              maxLength={160}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="label">Indirizzo app</label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-sm font-mono">
                /apps/
              </span>
              <input
                className="input pl-[4.4rem] font-mono"
                required
                minLength={2}
                maxLength={80}
                pattern="[a-z0-9-]+"
                value={editSlug}
                onChange={(e) => setEditSlug(slugifyClient(e.target.value))}
              />
            </div>
            <div className="help">Cambiare indirizzo cambia anche il link pubblico dell'app.</div>
          </div>
          <div className="field">
            <label className="label">Richiesta dell'app</label>
            <textarea
              className="textarea min-h-[160px]"
              maxLength={5000}
              value={editPrompt}
              onChange={(e) => setEditPrompt(e.target.value)}
              placeholder="Descrivi cosa deve fare l'app, quali utenti la usano, quali dati gestisce..."
            />
            <div className="help">Modifica questa richiesta e poi usa Aggiorna app per rigenerare struttura e preview.</div>
          </div>
          <label className="flex items-center gap-2 text-sm text-zinc-300">
            <input
              type="checkbox"
              checked={editPublicReg}
              onChange={(e) => setEditPublicReg(e.target.checked)}
              className="rounded accent-accent-500"
            />
            Permetti registrazione pubblica utenti
          </label>
          {formError && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/20 text-sm text-rose-200">
              {formError}
            </div>
          )}
          <div className="-mx-5 sm:-mx-6 -mb-5 px-5 sm:px-6 py-4 border-t border-white/[0.06] bg-ink-900/95 backdrop-blur-xl flex items-center justify-end gap-2">
            <button type="button" onClick={() => setEditOpen(false)} className="btn-ghost">Annulla</button>
            <button type="submit" disabled={saving} className="btn-primary">
              {saving ? <><Loader2 className="w-4 h-4 animate-spin" /> Salvo...</> : <><Save className="w-4 h-4" /> Salva</>}
            </button>
          </div>
        </form>
      </Modal>

      <Modal
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Elimina app"
        subtitle="Conferma solo se vuoi rimuovere davvero questa app."
        maxWidth="md"
      >
        <div className="space-y-5">
          <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 flex gap-3">
            <AlertTriangle className="w-5 h-5 text-rose-300 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-rose-100 font-medium">Stai eliminando "{tenant.name}".</p>
              <p className="text-sm text-rose-200/80 mt-1">
                Verranno rimossi utenti, dati, file e configurazioni. Non farlo su app acquistate o attive senza prima esportarle.
              </p>
            </div>
          </div>
          {formError && (
            <div className="px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/20 text-sm text-rose-200">
              {formError}
            </div>
          )}
          <div className="flex items-center justify-end gap-2">
            <button type="button" onClick={() => setDeleteOpen(false)} className="btn-ghost">Annulla</button>
            <button type="button" onClick={deleteApp} disabled={deleting} className="btn-danger">
              {deleting ? <><Loader2 className="w-4 h-4 animate-spin" /> Elimino...</> : <><Trash2 className="w-4 h-4" /> Elimina definitivamente</>}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
