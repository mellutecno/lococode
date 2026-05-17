import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity,
  Bot,
  Check,
  CircleHelp,
  ClipboardList,
  Database,
  ExternalLink,
  Eye,
  EyeOff,
  FileCode,
  FileStack,
  FolderKanban,
  Globe,
  KeyRound,
  LayoutDashboard,
  Lock,
  LogOut,
  Mail,
  Maximize2,
  Monitor,
  Plus,
  RotateCw,
  Search,
  Send,
  SlidersHorizontal,
  Smartphone,
  Sparkles,
  Tablet,
  Trash2,
  Workflow,
  X,
} from "lucide-react";
import { COMMON_MODELS, MODEL_LABELS } from "./models.js";

const API_BASE = (import.meta.env.VITE_LOCOCODE_API_URL || "").replace(/\/$/, "");
const SESSION_KEY = "lococode-session-token";
const PREVIEW_WIDTH_KEY = "lococode-preview-width";

const quickPrompts = [
  {
    label: "Gestionale studio medico",
    icon: Activity,
    prompt:
      "Voglio una web app gestionale per cure mediche e dentistiche: pazienti, appuntamenti, preventivi, piani cura, pagamenti e dashboard studio. Non deve fornire diagnosi o consigli medici.",
  },
  {
    label: "Dashboard commerciale",
    icon: LayoutDashboard,
    prompt: "Voglio una dashboard per commercialisti con clienti, fatture, scadenze fiscali, report e notifiche.",
  },
  {
    label: "CRM operativo",
    icon: ClipboardList,
    prompt: "Crea un CRM operativo con pipeline, contatti, attivita, preventivi e report vendite.",
  },
];

export default function App() {
  const [activeView, setActiveView] = useState("projects");
  const [apps, setApps] = useState([]);
  const [selectedAppId, setSelectedAppId] = useState("");
  const [projectName, setProjectName] = useState("");
  const [generationTier, setGenerationTier] = useState("base");
  const [tiersCatalog, setTiersCatalog] = useState({});
  const [prompt, setPrompt] = useState("");
  const [chatPrompt, setChatPrompt] = useState("");
  const [model, setModel] = useState(COMMON_MODELS[0]);
  const [apiKey, setApiKey] = useState("");
  const [sharedKeyInfo, setSharedKeyInfo] = useState({ available: false, using: false, trialDaysLeft: null, isSubscribed: false });
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("Pronto");
  const [error, setError] = useState("");
  const [apiCheck, setApiCheck] = useState("");
  const [searchTerm, setSearchTerm] = useState("");
  const [currentUser, setCurrentUser] = useState(null);
  const [authOpen, setAuthOpen] = useState(false);
  const [authEmail, setAuthEmail] = useState("");
  const [authToken, setAuthToken] = useState("");
  const [authStep, setAuthStep] = useState("email");
  const [authMessage, setAuthMessage] = useState("");

  const selectedApp = useMemo(
    () => apps.find((app) => app.id === selectedAppId) || apps[0] || null,
    [apps, selectedAppId],
  );

  async function handleDeleteApp(appId, appName) {
    if (!window.confirm(`Eliminare l'app "${appName}"?
Questa azione è irreversibile.`)) return;
    setBusy(true);
    try {
      await apiFetch(`/api/apps/${appId}`, { method: "DELETE" });
      setApps((prev) => prev.filter((a) => a.id !== appId));
      if (selectedAppId === appId) {
        setSelectedAppId("");
        setActiveView("projects");
      }
    } catch (err) {
      setError(`Errore eliminazione: ${err.message}`);
    } finally {
      setBusy(false);
    }
  }

  const filteredApps = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();
    if (!query) return apps;
    return apps.filter((app) => app.name?.toLowerCase().includes(query));
  }, [apps, searchTerm]);

  useEffect(() => {
    void bootstrap();
  }, []);

  useEffect(() => {
    if (!currentUser) return undefined;

    const sendHeartbeat = () => {
      void apiFetch("/api/heartbeat", { method: "POST" }).catch(() => {});
    };

    sendHeartbeat();
    const timer = window.setInterval(sendHeartbeat, 30000);
    const onVisibility = () => {
      if (!document.hidden) sendHeartbeat();
    };

    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [currentUser?.id]);

  useEffect(() => {
    const shouldPoll = selectedApp && (selectedApp.status === "building" || selectedApp.autopilot?.running);
    if (!shouldPoll) return undefined;

    const timer = window.setInterval(() => {
      void refreshApps(selectedApp.id);
    }, 2400);

    return () => window.clearInterval(timer);
  }, [selectedApp?.id, selectedApp?.status, selectedApp?.autopilot?.running]);

  // Carica il catalogo tier una sola volta (pubblico, no auth)
  useEffect(() => {
    fetch("/api/generation-tiers")
      .then((r) => (r.ok ? r.json() : { tiers: {} }))
      .then((d) => setTiersCatalog(d.tiers || {}))
      .catch(() => {});
  }, []);

  async function bootstrap() {
    const token = localStorage.getItem(SESSION_KEY);
    if (!token) {
      setStatus("Accesso richiesto");
      setAuthOpen(true);
      return;
    }

    const sessionResponse = await apiFetch("/api/auth/session");
    if (!sessionResponse.ok) {
      localStorage.removeItem(SESSION_KEY);
      setCurrentUser(null);
      setApps([]);
      setSelectedAppId("");
      setStatus("Accesso richiesto");
      setAuthOpen(true);
      return;
    }

    const sessionData = await readApiJson(sessionResponse);
    setCurrentUser(sessionData.user || null);
    await loadProtectedState();
  }

  async function loadProtectedState(nextSelectedId = selectedAppId) {
    const [settingsResponse, appsResponse] = await Promise.all([
      apiFetch("/api/settings"),
      apiFetch("/api/apps"),
    ]);
    const settings = await readApiJson(settingsResponse);
    const appData = await readApiJson(appsResponse);
    setApiKey(settings.openrouterApiKey || "");
    setModel(settings.defaultModel || COMMON_MODELS[0]);
    setSharedKeyInfo({
      available: settings.sharedKeyAvailable || false,
      using: settings.usingSharedKey || false,
      trialDaysLeft: settings.trialDaysLeft ?? null,
      isSubscribed: settings.isSubscribed || false,
    });
    setApps(appData.apps || []);
    if (nextSelectedId) setSelectedAppId(nextSelectedId);
    else if (appData.apps?.[0]) setSelectedAppId(appData.apps[0].id);
    setStatus("Pronto");
  }

  function requireAuth() {
    if (currentUser) return true;
    setAuthOpen(true);
    setStatus("Accesso richiesto");
    setError("Inserisci email e token per lavorare sul tuo workspace.");
    return false;
  }

  async function requestLoginToken() {
    const email = authEmail.trim();
    if (!email || busy) return;

    setBusy(true);
    setAuthMessage("Invio token...");
    setError("");
    try {
      const response = await apiFetch("/api/auth/request-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Invio token non riuscito.");
      setAuthStep("token");
      setAuthMessage(data.message || "Controlla la posta e inserisci il token.");
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function verifyLoginToken() {
    const email = authEmail.trim();
    const token = authToken.trim();
    if (!email || !token || busy) return;

    setBusy(true);
    setAuthMessage("Verifico token...");
    setError("");
    try {
      const response = await apiFetch("/api/auth/verify-token", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, token }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Token non valido.");
      localStorage.setItem(SESSION_KEY, data.sessionToken);
      setCurrentUser(data.user || null);
      setAuthToken("");
      setAuthOpen(false);
      setAuthMessage("");
      await loadProtectedState("");
    } catch (err) {
      setAuthMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function requestLicense(appId) {
    try {
      const response = await apiFetch(`/api/apps/${appId}/request-license`, { method: "POST" });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Errore invio richiesta.");
      setStatus(data.message || "Richiesta licenza inviata.");
      await refreshApps(appId);
    } catch (err) {
      setError(err.message);
    }
  }

  // Avvia acquisto: chiama /purchase, riceve approval_url, apre la finestra
  // di pagamento (PayPal in live, conferma locale in sandbox).
  async function purchaseTier(appId, tier) {
    try {
      const response = await apiFetch(`/api/apps/${appId}/purchase`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tier }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Errore creazione ordine.");
      if (data.approvalUrl) {
        // Apre in nuova tab. In sandbox e una pagina locale che simula PayPal.
        window.open(data.approvalUrl, "_blank", "noopener");
        setStatus(`Ordine ${data.orderId} creato. Completa il pagamento nella nuova tab.`);
        // Poll per vedere se l'ordine viene confermato (in sandbox e immediato)
        setTimeout(() => refreshApps(appId), 4000);
      } else {
        setStatus("Ordine creato. Controlla la tua email per completare il pagamento.");
      }
    } catch (err) {
      setError(err.message);
    }
  }

  async function logout() {
    await apiFetch("/api/auth/logout", { method: "POST" });
    localStorage.removeItem(SESSION_KEY);
    setCurrentUser(null);
    setApps([]);
    setSelectedAppId("");
    setActiveView("projects");
    setAuthOpen(true);
    setStatus("Accesso richiesto");
  }

  async function saveSettings() {
    if (!requireAuth()) return;
    setStatus("Salvataggio impostazioni...");
    setError("");
    try {
      const response = await apiFetch("/api/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: apiKey, defaultModel: model }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Salvataggio impostazioni non riuscito.");
      setApiKey(data.openrouterApiKey || "");
      setModel(data.defaultModel || COMMON_MODELS[0]);
      setStatus("Impostazioni salvate");
      setActiveView(selectedAppId ? "chat" : "projects");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Errore impostazioni");
    }
  }

  async function generateApp({ text, appId = "", overrideModel = "", name = "", tier = "base", kind = "", notifyEmailOnEstimate = false, notifyEmailOnReady = false }) {
    if (!requireAuth()) return;
    const cleanPrompt = text.trim();
    if (!cleanPrompt || busy) return;
    const cleanProjectName = String(name || "").trim();
    if (!appId && !cleanProjectName) {
      setError("Inserisci un nome per l'app prima di avviare la generazione.");
      setStatus("Nome app mancante");
      return;
    }
    const chosenModel = overrideModel || model;

    setBusy(true);
    setError("");
    setStatus("Avvio LocoCode...");

    try {
      const response = await apiFetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt: cleanPrompt,
          projectName: cleanProjectName,
          model: chosenModel,
          appId,
          generationTier: tier,
          kind: kind || "webapp",
          openrouterApiKey: apiKey,
          notifyEmailOnEstimate: !!notifyEmailOnEstimate,
          notifyEmailOnReady: !!notifyEmailOnReady,
        }),
      });

      const data = await readApiJson(response);
      if (!response.ok) {
        if (data.app?.id) {
          await refreshApps(data.app.id);
          setActiveView("chat");
        }
        throw new Error(data.error || "Generazione non riuscita.");
      }

      await refreshApps(data.app.id);
      if (!appId) setProjectName("");
      setPrompt("");
      setChatPrompt("");
      setActiveView("chat");
      setStatus("Avanzamento avviato");
      if (data.error) setError(data.error);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Errore");
    } finally {
      setBusy(false);
    }
  }

  async function confirmEstimatePayment(appId, opts = {}) {
    if (!requireAuth()) return;
    setBusy(true); setError(""); setStatus("Conferma pagamento...");
    try {
      const response = await apiFetch(`/api/apps/${appId}/confirm-payment`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paymentMethod: opts.paymentMethod || "sandbox",
          orderId: opts.orderId || "",
          notifyEmailOnReady: !!opts.notifyEmailOnReady,
        }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Conferma pagamento fallita.");
      await refreshApps(data.app.id);
      setActiveView("chat");
      setStatus("Generazione ripresa");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Errore conferma");
    } finally {
      setBusy(false);
    }
  }

  async function cancelEstimate(appId) {
    if (!requireAuth()) return;
    if (!confirm("Confermi l'annullamento? La preventivazione verrà chiusa senza addebiti.")) return;
    setBusy(true); setError("");
    try {
      const response = await apiFetch(`/api/apps/${appId}/cancel-estimate`, { method: "POST" });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Annullamento fallito.");
      await refreshApps();
      setActiveView("projects");
      setStatus("Preventivo annullato");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function refreshApps(nextSelectedId = selectedAppId) {
    if (!currentUser) return;
    const response = await apiFetch("/api/apps");
    const data = await readApiJson(response);
    setApps(data.apps || []);
    if (nextSelectedId) setSelectedAppId(nextSelectedId);
    else if (data.apps?.[0]) setSelectedAppId(data.apps[0].id);
  }

  async function resumeAutopilot() {
    if (!requireAuth()) return;
    if (!selectedApp || busy) return;
    const projectModel = selectedApp.model || model;

    setBusy(true);
    setError("");
    setStatus("Riavvio avanzamento");

    try {
      const response = await apiFetch(`/api/apps/${selectedApp.id}/autopilot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: projectModel, openrouterApiKey: apiKey }),
      });
      const data = await readApiJson(response);
      if (!response.ok) {
        if (data.app?.id) await refreshApps(data.app.id);
        throw new Error(data.error || "Continuazione non riuscita.");
      }
      await refreshApps(data.app.id);
      setActiveView("chat");
      setStatus("Avanzamento attivo");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Errore");
    } finally {
      setBusy(false);
    }
  }

  async function stopAutopilot() {
    if (!requireAuth()) return;
    if (!selectedApp || busy) return;
    setBusy(true);
    setError("");
    setStatus("Richiedo pausa avanzamento...");

    try {
      const response = await apiFetch(`/api/apps/${selectedApp.id}/stop`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Stop non riuscito.");
      await refreshApps(data.app.id);
      setActiveView("chat");
      setStatus("Avanzamento in pausa");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Errore");
    } finally {
      setBusy(false);
    }
  }

  async function clearProjectLogs() {
    if (!requireAuth()) return;
    if (!selectedApp || busy) return;
    setBusy(true);
    setError("");
    setStatus("Pulizia log...");

    try {
      const response = await apiFetch(`/api/apps/${selectedApp.id}/logs`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Pulizia log non riuscita.");
      await refreshApps(data.app.id);
      setActiveView("log");
      setStatus("Log puliti");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setStatus("Errore pulizia log");
    } finally {
      setBusy(false);
    }
  }

  async function testApiConnection() {
    if (!requireAuth()) return;
    setApiCheck("Test API in corso...");
    setStatus("Test API...");
    setError("");
    try {
      const response = await apiFetch("/api/check-openrouter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ openrouterApiKey: apiKey, model }),
      });
      const data = await readApiJson(response);
      if (!response.ok) throw new Error(data.error || "Test API fallito.");
      setApiCheck(`Connessione riuscita con ${modelLabel(data.model)} in ${data.ms} ms`);
      setStatus("API pronta");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setApiCheck(`Errore API: ${message}`);
      setError(message);
      setStatus("Errore API");
    }
  }

  return (
    <main className="app-shell">
      <Rail activeView={activeView} setActiveView={(view) => {
        if (!currentUser && !["projects", "apps", "help"].includes(view)) {
          setAuthOpen(true);
          return;
        }
        setActiveView(view);
      }} />

      <section className="main-stage">
        <AppHeader
          selectedApp={selectedApp}
          status={status}
          activeView={activeView}
          currentUser={currentUser}
          onAuth={() => setAuthOpen(true)}
          onLogout={logout}
        />

        {activeView === "projects" && (
          <ProjectsView
            apps={filteredApps}
            onDeleteApp={handleDeleteApp}
            selectedApp={selectedApp}
            currentUser={currentUser}
            searchTerm={searchTerm}
            setSearchTerm={setSearchTerm}
            setActiveView={(view) => {
              if (!currentUser && view !== "apps") setAuthOpen(true);
              else setActiveView(view);
            }}
            setSelectedAppId={setSelectedAppId}
            onAuth={() => setAuthOpen(true)}
          />
        )}

        {activeView === "apps" && (
          <HomeView
            prompt={prompt}
            setPrompt={setPrompt}
            projectName={projectName}
            setProjectName={setProjectName}
            model={model}
            setModel={setModel}
            busy={busy}
            generationTier={generationTier}
            setGenerationTier={setGenerationTier}
            tiersCatalog={tiersCatalog}
            isAdmin={currentUser?.isAdmin === true}
            onGenerate={(notifyEst, notifyReady) => generateApp({ text: prompt, name: projectName, tier: generationTier, kind: "webapp", notifyEmailOnEstimate: notifyEst, notifyEmailOnReady: notifyReady })}
            onQuick={(item, notifyEst, notifyReady) => {
              setProjectName(item.label);
              setPrompt(item.prompt);
              void generateApp({ text: item.prompt, name: item.label, tier: generationTier, kind: "webapp", notifyEmailOnEstimate: notifyEst, notifyEmailOnReady: notifyReady });
            }}
          />
        )}

        {activeView === "website" && (
          <WebsiteHomeView
            busy={busy}
            onBackToProjects={() => setActiveView("projects")}
            onGenerate={({ text, name, kind }) => generateApp({ text, name, tier: "base", kind })}
          />
        )}

        {activeView === "chat" && selectedApp?.paymentFlow?.status === "estimate_pending" && (
          <AnalyzingView
            app={selectedApp}
            onBackToProjects={() => setActiveView("projects")}
          />
        )}

        {activeView === "chat" && selectedApp?.paymentFlow?.status === "awaiting_payment" && (
          <EstimateView
            app={selectedApp}
            busy={busy}
            onConfirmPayment={confirmEstimatePayment}
            onCancelEstimate={cancelEstimate}
            onBackToProjects={() => setActiveView("projects")}
          />
        )}

        {activeView === "chat" && !["estimate_pending", "awaiting_payment"].includes(selectedApp?.paymentFlow?.status) && (
          <ChatView
            app={selectedApp}
            chatPrompt={chatPrompt}
            setChatPrompt={setChatPrompt}
            busy={busy}
            status={status}
            error={error}
            onSend={() => generateApp({ text: chatPrompt, appId: selectedApp?.id || "", overrideModel: selectedApp?.model || model })}
            onResume={resumeAutopilot}
            onStop={stopAutopilot}
            onBackToProjects={() => setActiveView("projects")}
            onRequestLicense={requestLicense}
            onPurchaseTier={purchaseTier}
          />
        )}

        {activeView === "settings" && (
          <SettingsView
            apiKey={apiKey}
            setApiKey={setApiKey}
            model={model}
            setModel={setModel}
            onSave={saveSettings}
            onTest={testApiConnection}
            apiCheck={apiCheck}
            sharedKeyInfo={sharedKeyInfo}
            currentUser={currentUser}
            apps={apps}
          />
        )}

        {activeView === "tasks" && <TasksWorkspace app={selectedApp} />}
        {activeView === "sdd" && <SddWorkspace app={selectedApp} />}
        {activeView === "log" && <LogWorkspace app={selectedApp} status={status} error={error} onClearLogs={clearProjectLogs} busy={busy} />}
        {activeView === "help" && <HelpView />}

        {error && <div className="toast">{error}</div>}
      </section>

      {authOpen && (
        <AuthModal
          email={authEmail}
          setEmail={setAuthEmail}
          token={authToken}
          setToken={setAuthToken}
          step={authStep}
          setStep={setAuthStep}
          message={authMessage}
          busy={busy}
          onRequestToken={requestLoginToken}
          onVerifyToken={verifyLoginToken}
          onClose={() => setAuthOpen(false)}
        />
      )}
    </main>
  );
}

function Rail({ activeView, setActiveView }) {
  return (
    <nav className="rail">
      <img className="rail-logo" src="/lococode_logo.png" alt="LocoCode" />
      <NavButton icon={FolderKanban} label="Workspace" active={activeView === "projects"} onClick={() => setActiveView("projects")} />
      <NavButton icon={Workflow} label="Lavoro" active={activeView === "chat"} onClick={() => setActiveView("chat")} title="LocoCode" />
      <NavButton icon={ClipboardList} label="Task" active={activeView === "tasks"} onClick={() => setActiveView("tasks")} />
      <NavButton icon={FileStack} label="Piano" active={activeView === "sdd"} onClick={() => setActiveView("sdd")} />
      <NavButton icon={Activity} label="Log" active={activeView === "log"} onClick={() => setActiveView("log")} title="Registro operativo" />
      <div className="rail-spacer" />
      <NavButton icon={SlidersHorizontal} label="Setup" active={activeView === "settings"} onClick={() => setActiveView("settings")} title="Impostazioni" />
      <NavButton icon={CircleHelp} label="Aiuto" active={activeView === "help"} onClick={() => setActiveView("help")} />
    </nav>
  );
}

function NavButton({ active, icon: Icon, label, onClick, title }) {
  return (
    <button className={`rail-button ${active ? "active" : ""}`} onClick={onClick} title={title || label}>
      <Icon size={25} strokeWidth={2.15} />
      <span>{label}</span>
    </button>
  );
}

function clampPreviewWidth(value) {
  return Math.min(72, Math.max(34, Number(value) || 54));
}

function AuthModal({ email, setEmail, token, setToken, step, setStep, message, busy, onRequestToken, onVerifyToken, onClose }) {
  const enteringToken = step === "token";

  return (
    <section className="auth-overlay" role="dialog" aria-modal="true" aria-label="Accesso LocoCode">
      <div className="auth-card">
        <button className="auth-close" onClick={onClose} aria-label="Chiudi accesso">
          <X size={20} />
        </button>
        <div className="auth-icon">
          {enteringToken ? <KeyRound size={28} /> : <Mail size={28} />}
        </div>
        <h2>Accedi al tuo workspace</h2>
        <p>
          {enteringToken
            ? "Inserisci email e token gia ricevuto. Non ne genero uno nuovo."
            : "Inserisci la tua email: ti mandiamo un token temporaneo. Da quel momento lavorerai solo nella tua cartella utente."}
        </p>

        <label>
          Email
          <input
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="nome@email.it"
            type="email"
            autoComplete="email"
          />
        </label>

        {enteringToken && (
          <label>
            Token
            <input
              value={token}
              onChange={(event) => setToken(event.target.value)}
              placeholder="123456"
              inputMode="numeric"
              autoComplete="one-time-code"
            />
          </label>
        )}

        {message && <p className="auth-message">{message}</p>}

        <div className="auth-actions">
          {enteringToken ? (
            <button className="secondary-action" type="button" onClick={() => setStep("email")}>
              Cambia email
            </button>
          ) : (
            <button className="secondary-action" type="button" onClick={() => setStep("token")}>
              Ho gia un token
            </button>
          )}
          <button
            className="primary"
            type="button"
            disabled={busy || !email.trim() || (enteringToken && !token.trim())}
            onClick={enteringToken ? onVerifyToken : onRequestToken}
          >
            {enteringToken ? "Entra" : "Invia token"}
          </button>
        </div>
      </div>
    </section>
  );
}

function ProjectsView({ apps, selectedApp, currentUser, searchTerm, setSearchTerm, setActiveView, setSelectedAppId, onAuth, onDeleteApp }) {
  const isEmpty = currentUser && !apps.length;
  return (
    <div className="projects-view">
      <section className="projects-card">
        <div className="projects-head">
          <div>
            <span>Area lavoro</span>
            <h1>Workspace</h1>
          </div>
          {!isEmpty && (
            <div className="projects-head-actions">
              <button className="primary" onClick={() => setActiveView("apps")}>
                <Plus size={20} />
                <span>Nuova web app</span>
              </button>
            </div>
          )}
        </div>
        {!isEmpty && (
          <label className="project-search">
            <Search size={22} />
            <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cerca nel workspace" />
          </label>
        )}

        {isEmpty ? (
          <div className="creation-choice">
            <h2 className="creation-choice-title">Crea la tua prima web app</h2>
            <p className="creation-choice-sub">Gestionali, dashboard, strumenti interattivi. Backend, database e login inclusi.</p>
            <div className="creation-choice-grid">
              <button className="creation-card creation-card-app" onClick={() => setActiveView("apps")}>
                <div className="creation-card-icon"><Workflow size={28} /></div>
                <h3>Web App</h3>
                <p>Gestionali, dashboard, strumenti interattivi. Database incluso, login, area utenti, dati salvati.</p>
                <ul className="creation-card-features">
                  <li>Backend + database</li>
                  <li>Login e registrazione</li>
                  <li>Dati persistenti</li>
                </ul>
                <span className="creation-card-cta">Inizia →</span>
              </button>
            </div>
          </div>
        ) : (
          <div className="project-grid">
            {!currentUser && (
              <button className="project-tile auth-item" onClick={onAuth}>
                <strong>Accedi con token</strong>
                <span>Inserisci email e token per vedere il tuo workspace.</span>
              </button>
            )}
            {apps.map((app) => {
              const isWebsite = app.kind === "website";
              return (
                <div
                  key={app.id}
                  className={`project-tile ${selectedApp?.id === app.id ? "selected" : ""}`}
                  data-status={app.status || "idle"}
                  data-kind={app.kind || "webapp"}
                  onClick={() => {
                    setSelectedAppId(app.id);
                    setActiveView("chat");
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setSelectedAppId(app.id); setActiveView("chat"); } }}
                >
                  <div className="project-tile-kind-badge">
                    {isWebsite ? <><Globe size={11} /> Sito web</> : <><Workflow size={11} /> Web app</>}
                  </div>
                  <strong>{app.name}</strong>
                  <span>{formatDate(app.updatedAt)}</span>
                  <em>{projectTaskState(app).short}</em>
                  <div className="project-tile-actions" onClick={(e) => e.stopPropagation()}>
                    {app.appUrl && (
                      <a className="tile-icon-btn" href={app.appUrl} target="_blank" rel="noreferrer" title="Apri app" onClick={(e) => e.stopPropagation()}>
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {onDeleteApp && (
                      <button className="tile-icon-btn danger" title="Elimina app" onClick={(e) => { e.stopPropagation(); onDeleteApp(app.id, app.name); }}>
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}

function AppHeader({ selectedApp, status, activeView, currentUser, onAuth, onLogout }) {
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!userMenuOpen) return undefined;
    const close = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setUserMenuOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [userMenuOpen]);

  const label =
    ["chat", "tasks", "sdd", "files", "log"].includes(activeView) && selectedApp
      ? selectedApp.name
      : activeView === "settings"
        ? "Impostazioni"
        : activeView === "help"
          ? "Aiuto"
          : activeView === "projects"
            ? "Il tuo workspace"
            : "Nuova app";

  const viewLabel = {
    projects: "Workspace",
    apps: "Nuova app",
    chat: "LocoCode",
    tasks: "Task progetto",
    sdd: "Piano progetto",
    files: "File progetto",
    log: "Registro operativo",
    settings: "Configurazione",
    help: "Guida",
  }[activeView] || "LocoCode";

  const taskText = ["chat", "tasks", "sdd", "files", "log"].includes(activeView) && selectedApp ? projectTaskState(selectedApp).header : status;

  return (
    <header className="app-header">
      <div className="header-title">
        <span>{viewLabel}</span>
        <strong>{label}</strong>
      </div>
      <p className={activeView === "chat" && selectedApp?.status === "error" ? "status-error" : ""}>{taskText}</p>
      {currentUser ? (
        <div className="user-menu-container" ref={menuRef}>
          <button
            className="user-avatar-btn"
            onClick={() => setUserMenuOpen((o) => !o)}
            title={currentUser.email}
            aria-label="Account"
            aria-expanded={userMenuOpen}
          >
            {currentUser.email[0].toUpperCase()}
          </button>
          {userMenuOpen && (
            <div className="user-menu-dropdown" role="menu">
              <span className="user-menu-email">{currentUser.email}</span>
              <button className="user-menu-logout" onClick={() => { onLogout(); setUserMenuOpen(false); }}>
                <LogOut size={15} />
                Esci dall&apos;account
              </button>
            </div>
          )}
        </div>
      ) : (
        <button className="user-button" aria-label="Accedi" onClick={onAuth}>
          <KeyRound size={20} />
          <span>Accedi</span>
        </button>
      )}
    </header>
  );
}

const FALLBACK_TIERS = {
  starter: { key: "starter", label: "Starter", description: "App completa con frontend curato (Kimi K2.6) e backend solido", color: "#3b82f6", feeEur: 4.99, estCost: { min: 0.30, max: 0.70 }, hasReview: false },
  pro: { key: "pro", label: "Pro", description: "Frontend + review automatica del design con Claude Haiku 4.5", color: "#8b5cf6", feeEur: 9.99, estCost: { min: 0.50, max: 0.90 }, hasReview: true },
  premium: { key: "premium", label: "Premium", description: "Tutto Claude Sonnet 4.5 + review GPT-5. Massima qualita.", color: "#f59e0b", feeEur: 19.99, estCost: { min: 1.50, max: 3.50 }, hasReview: true },
};

function TierSelector({ value, onChange, isAdmin, tiersCatalog }) {
  // Tier visualizzati come "tipi di app" con esempi concreti. Niente prezzi
  // esposti qui: l'utente sceglie cosa vuole, il prezzo emerge dal SDD dopo.
  const TIER_PROFILES = {
    starter: {
      label: "Starter",
      tagline: "App semplici o medie",
      examples: ["Lista della spesa", "Mini gestionale", "Blog con login", "Form complessi"],
      icon: "📋",
      color: "#3b82f6",
    },
    pro: {
      label: "Pro",
      tagline: "App complete",
      examples: ["Gestionale clienti", "Dashboard analitica", "E-commerce semplice", "CRM"],
      icon: "💼",
      color: "#8b5cf6",
    },
    premium: {
      label: "Premium",
      tagline: "App complesse",
      examples: ["CRM multi-utente", "Marketplace", "Piattaforma con AI", "App con pagamenti"],
      icon: "💎",
      color: "#f59e0b",
    },
  };
  const order = ["starter", "pro", "premium"];
  return (
    <div className="tier-selector">
      <div className="tier-selector-head">
        <strong>Che tipo di app vuoi creare?</strong>
        <span>Scegli la categoria che meglio descrive la tua idea. Il prezzo finale verrà calcolato dopo l'analisi (sempre rimborsato se ti abboni o compri la licenza).</span>
      </div>
      <div className="tier-grid">
        {order.map((k) => {
          const profile = TIER_PROFILES[k];
          const active = value === k;
          return (
            <button
              key={k}
              type="button"
              className={`tier-card ${active ? "active" : ""}`}
              style={{ "--tier-color": profile.color }}
              onClick={() => onChange(k)}
              title={profile.tagline}
            >
              <div className="tier-card-icon">{profile.icon}</div>
              <div className="tier-card-head">
                <span className="tier-card-label">{profile.label}</span>
              </div>
              <div className="tier-card-desc">{profile.tagline}</div>
              <ul className="tier-card-examples">
                {profile.examples.map((ex) => <li key={ex}>{ex}</li>)}
              </ul>
            </button>
          );
        })}
      </div>
      <p className="tier-hint">
        💡 Il prezzo finale dipende dalla complessità reale rilevata dall'analisi della tua idea, dalla categoria che scegli, e potrai sempre rifiutare se non ti convince — niente addebiti senza la tua conferma.
      </p>
    </div>
  );
}

function HomeView({ prompt, setPrompt, projectName, setProjectName, model, setModel, busy, onGenerate, onQuick, generationTier, setGenerationTier, isAdmin, tiersCatalog }) {
  // Due opt-in email distinti: il primo per "preventivo pronto" (utile a
  // chi non vuole stare appeso al browser durante l'analisi), il secondo
  // per "app pronta" (utile a chi non vuole stare appeso durante la
  // generazione completa, che puo' durare diversi minuti).
  const [notifyEstimate, setNotifyEstimate] = useState(false);
  const [notifyReady, setNotifyReady] = useState(false);

  return (
    <div className="home-view">
      <section className="hero-block">
        <div className="hero-badge"><Sparkles size={12} /> AI App Builder</div>
        <h1>Crea la tua web app</h1>
        <p className="hero-sub">Descrivi cosa vuoi costruire — LocoCode genera backend, frontend e database pronti all'uso.</p>

        {/* Avviso preliminare visibile SUBITO, prima del prompt: gestisce
            l'aspettativa dell'utente sui tempi e propone gia' le mail. */}
        <div className="hero-time-notice" style={{ background: "rgba(91,62,232,0.10)", border: "1px solid rgba(124,90,240,0.30)", padding: "12px 16px", borderRadius: 12, color: "#cbd5e1", fontSize: 13, marginBottom: 16, lineHeight: 1.55 }}>
          ⏱ <strong style={{ color: "#f1f5f9" }}>Tempi medi:</strong> ~2 min per il preventivo, ~5-10 min per la generazione completa. Se non vuoi attendere, lascia le spunte qui sotto e ti avviseremo via email.
        </div>

        <label className="project-name-field">
          <span>Nome app</span>
          <input
            value={projectName}
            onChange={(event) => setProjectName(event.target.value)}
            placeholder="Esempio: Gestionale studio medico"
          />
        </label>
        <Composer
          value={prompt}
          onChange={setPrompt}
          model={model}
          setModel={setModel}
          busy={busy}
          placeholder="Descrivi l'app da creare..."
          onSubmit={() => onGenerate(notifyEstimate, notifyReady)}
          showModel={false}
        />
        <div className="notify-mail-block" style={{ marginTop: 14, display: "flex", flexDirection: "column", gap: 10 }}>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#cbd5e1", fontSize: 14 }}>
            <input type="checkbox" checked={notifyEstimate} onChange={(e) => setNotifyEstimate(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Avvisami via email <strong>quando il preventivo e' pronto</strong> (analisi finita, devi solo confermare il prezzo).</span>
          </label>
          <label style={{ display: "flex", gap: 10, alignItems: "flex-start", color: "#cbd5e1", fontSize: 14 }}>
            <input type="checkbox" checked={notifyReady} onChange={(e) => setNotifyReady(e.target.checked)} style={{ marginTop: 3 }} />
            <span>Avvisami via email <strong>quando l'app e' pronta e online</strong> (con il link per provarla e le credenziali).</span>
          </label>
        </div>
      </section>
    </div>
  );
}

// Form dedicato alla creazione di siti web (vetrina statica). Differenza dal
// flusso web app: niente tier selector visibile (tutti i siti usano lo stesso
// pipeline ridotto), e campi guidati per business invece di prompt libero.
// FILOSOFIA: solo NOME e CITTA' sono obbligatori. Tutto il resto (tel, indirizzo,
// orari, menu, foto) viene CERCATO AUTOMATICAMENTE sul web. L'utente compila
// extra solo se VUOLE forzare un valore specifico.
function WebsiteHomeView({ busy, onGenerate, onBackToProjects }) {
  const [businessName, setBusinessName] = useState("");
  const [businessType, setBusinessType] = useState("pizzeria");
  const [customType, setCustomType] = useState("");
  const [city, setCity] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");

  const businessTypes = [
    { value: "pizzeria", label: "Pizzeria" },
    { value: "ristorante", label: "Ristorante" },
    { value: "bar", label: "Bar / Caffetteria" },
    { value: "trattoria", label: "Trattoria / Osteria" },
    { value: "gelateria", label: "Gelateria / Pasticceria" },
    { value: "parrucchiere", label: "Parrucchiere / Barber" },
    { value: "estetista", label: "Centro estetico" },
    { value: "officina", label: "Officina / Carrozzeria" },
    { value: "studio", label: "Studio professionale" },
    { value: "palestra", label: "Palestra / Centro sportivo" },
    { value: "hotel", label: "Hotel / B&B" },
    { value: "negozio", label: "Negozio / Boutique" },
    { value: "altro", label: "Altro (specifica)…" },
  ];

  const canSubmit = businessName.trim().length > 0 && city.trim().length > 0 && !busy;
  const isCustomType = businessType === "altro";

  function buildPrompt() {
    const typeLabel = isCustomType && customType.trim()
      ? customType.trim()
      : businessTypes.find((t) => t.value === businessType)?.label || businessType;
    const lines = [
      `Sito web vetrina per: ${businessName.trim()} (${typeLabel}) a ${city.trim()}.`,
    ];
    if (phone.trim()) lines.push(`Telefono (fornito dal titolare): ${phone.trim()}.`);
    if (address.trim()) lines.push(`Indirizzo (fornito dal titolare): ${address.trim()}.`);
    if (description.trim()) lines.push(`Descrizione del sito richiesta dal titolare (criterio di ricerca e generazione): ${description.trim()}`);
    lines.push(
      "",
      "IMPORTANTE: cerca su Google/Maps/Tripadvisor/Facebook/sito ufficiale dell'attivita' TUTTE le info disponibili: indirizzo completo, telefono, orari (giorni e fasce), descrizione reale, menu/servizi/prezzi, foto vere del locale (interno/esterno/piatti), titolare/chef se presente, recensioni. Usa i dati REALI trovati come fonte primaria; se trovi un'info diversa da quella che ti ha dato il titolare, preferisci quella REALE (la web search e' verificata).",
      "Sezioni obbligatorie del sito: Hero con call-to-action, Chi siamo (con storia reale se trovata), Menu/Servizi (voci REALI con prezzi), Galleria (foto REALI scaricate dal sito ufficiale o Unsplash come fallback), Contatti con telefono cliccabile + mappa Google embed dell'indirizzo reale, Footer con orari REALI.",
      "Niente login, niente backend, niente database. Sito puramente vetrina, single-page con scroll fluido.",
    );
    return lines.join("\n");
  }

  return (
    <div className="home-view">
      <section className="hero-block">
        <button className="back-link" onClick={onBackToProjects}>← Torna al workspace</button>
        <div className="hero-badge"><Globe size={12} /> Sito web vetrina</div>
        <h1>Crea il sito della tua attività</h1>

        <div className="website-form">
          <label className="project-name-field">
            <span>Nome attività *</span>
            <input
              value={businessName}
              onChange={(e) => setBusinessName(e.target.value)}
              placeholder="Esempio: Pizzeria Il Mago Quattro"
            />
          </label>

          <div className="website-form-row">
            <label className="project-name-field">
              <span>Tipo di attività *</span>
              <select className="website-select" value={businessType} onChange={(e) => setBusinessType(e.target.value)}>
                {businessTypes.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </label>
            <label className="project-name-field">
              <span>Città *</span>
              <input
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="Esempio: Casorate Primo"
              />
            </label>
          </div>

          {isCustomType && (
            <label className="project-name-field">
              <span>Specifica il tipo di attività *</span>
              <input
                value={customType}
                onChange={(e) => setCustomType(e.target.value)}
                placeholder="Es: Erboristeria, Lavanderia, Veterinario, Tatuatore..."
              />
            </label>
          )}

          <div className="website-form-row">
            <label className="project-name-field">
              <span>Telefono</span>
              <input
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="Es: 02 12345678"
              />
              <small className="field-helper">Se lo lasci vuoto, proveremo a cercarlo noi.</small>
            </label>
            <label className="project-name-field">
              <span>Indirizzo</span>
              <input
                value={address}
                onChange={(e) => setAddress(e.target.value)}
                placeholder="Es: Via Roma 12"
              />
              <small className="field-helper">Se lo lasci vuoto, proveremo a cercarlo noi.</small>
            </label>
          </div>

          <label className="project-name-field">
            <span>Descrizione</span>
            <textarea
              className="website-textarea"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Descrivi il sito che vuoi: cosa includere, cosa NON includere, stile preferito. Es: 'sito elegante per pizzeria napoletana, evidenzia il forno a legna, non mostrare prezzi, aggiungi sezione eventi'..."
              rows={4}
            />
          </label>

          <button
            className="primary website-submit"
            disabled={!canSubmit}
            onClick={() => onGenerate({
              text: buildPrompt(),
              name: businessName.trim(),
              kind: "website",
            })}
          >
            {busy ? <><Sparkles className="spin" size={18} /> Creazione in corso…</> : <><Globe size={18} /> Crea il sito</>}
          </button>
        </div>
      </section>
    </div>
  );
}

function Composer({ value, onChange, model, setModel, busy, placeholder, onSubmit, showModel = true }) {
  return (
    <section className="composer">
      <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} />
      <button className="send-button" aria-label="Genera" disabled={busy || !value.trim()} onClick={onSubmit}>
        {busy ? <Sparkles className="spin" size={26} /> : <Send size={26} />}
      </button>
      <div className="composer-footer">
        <span className="agent-chip">
          <Bot size={18} />
          LocoCode
        </span>
        {showModel && <ModelSelect value={model} onChange={setModel} compact />}
      </div>
    </section>
  );
}

function PricingCard({ app, onPurchaseTier }) {
  if (!app?.pricing || !app.lifecycle || app.lifecycle === "exported") return null;

  const isExportedAlready = app.lifecycle === "exported";
  const isHosted = app.lifecycle === "hosted_lococode_api" || app.lifecycle === "hosted_user_api";

  const plans = [
    {
      key: "hosted_lococode_api",
      title: "Hosting LocoCode (full)",
      tagline: "L'app resta online sui nostri server con URL pubblico lococode.mellutecno.it/app/tua-app. Servizi cloud inclusi se l'app li richiede.",
      price: app.pricing.plans.hosted_lococode_api,
      cta: "Abbonati",
      featured: true,
      features: [
        "Hosting + dominio lococode.mellutecno.it",
        "Backup automatici",
        "Pacchetto servizi cloud incluso (se l'app li usa)",
        "Aggiornamenti e manutenzione sul server LocoCode",
      ],
    },
    {
      key: "hosted_user_api",
      title: "Hosting LocoCode (BYO keys)",
      tagline: "L'app resta online sui nostri server, ma usi le tue chiavi per servizi esterni o AI se l'app li richiede.",
      price: app.pricing.plans.hosted_user_api,
      cta: "Abbonati",
      features: [
        "Hosting + dominio lococode.mellutecno.it",
        "Backup automatici",
        "Chiavi servizi cloud a tuo carico (solo se l'app li usa)",
        "Aggiornamenti e manutenzione sul server LocoCode",
      ],
    },
    {
      key: "exported",
      title: "Esporta tutto",
      tagline: "Scarichi tutto e lo metti sul TUO dominio (es. miaazienda.it). Server, chiavi e gestione completamente tue.",
      price: app.pricing.plans.exported,
      cta: "Acquista codice",
      features: [
        "Codice sorgente completo + script deploy",
        "Tuo dominio personalizzato, tuo hosting",
        "Chiavi servizi cloud a tuo carico (solo se l'app li usa)",
        "Pagamento una tantum, nessun vincolo",
      ],
    },
  ];

  return (
    <section className="pricing-card-wrap">
      <header className="pricing-card-header">
        <div>
          <h3>Acquista licenza</h3>
          <p>
            Complessità app: <strong>{app.pricing.tier}</strong> (score {app.pricing.score})
            {" · "}
            {app.pricing.metrics.doneTasks} task · {app.pricing.metrics.fileCount} file
            {app.pricing.metrics.hasBackend ? " · backend incluso" : ""}
          </p>
          {typeof app.pricing.generationFeeEur === "number" && app.pricing.generationFeeEur > 0 && (
            <p style={{ marginTop: 6, color: "var(--success)", fontSize: 12, fontWeight: 600 }}>
              ✓ Hai pagato <strong>€{app.pricing.generationFeeEur.toFixed(2)}</strong> per la creazione — viene scalato dal piano che scegli.
            </p>
          )}
        </div>
        {app.lifecycle !== "trial" && (
          <span className="pricing-lifecycle-badge">Piano attivo: {app.lifecycle.replace(/_/g, " ")}</span>
        )}
      </header>

      {/* Disclaimer AI: le app che usano intelligenza artificiale a runtime
          (chiamate OpenAI/Claude/ecc dentro l'app generata) consumano token
          ogni volta che l'utente le usa. Non possiamo includerle in un
          abbonamento forfettario senza rischio di erosione del margine.
          Pricing dedicato in arrivo: per ora preventivo a parte su richiesta. */}
      <div style={{
        margin: "12px 0 18px",
        padding: "14px 18px",
        background: "rgba(245, 158, 11, 0.08)",
        border: "1px solid rgba(245, 158, 11, 0.30)",
        borderRadius: 12,
        color: "#fde68a",
        fontSize: 13,
        lineHeight: 1.55,
      }}>
        ⚠️ <strong style={{ color: "#fbbf24" }}>App con AI integrata:</strong> se la tua app prevede chiamate a modelli AI (ChatGPT, Claude, Gemini, ecc.) il costo di utilizzo NON e' incluso negli abbonamenti qui sotto. Avra' un pricing dedicato in base al volume di chiamate. Scrivici per un preventivo personalizzato.
      </div>

      <div className="pricing-plans">
        {plans.map((plan) => (
          <article key={plan.key} className={`pricing-plan ${plan.featured ? "featured" : ""} ${app.lifecycle === plan.key ? "current" : ""}`}>
            <div className="pricing-plan-head">
              <h4>{plan.title}</h4>
              <p>{plan.tagline}</p>
            </div>
            <div className="pricing-plan-price">
              {plan.price.monthlyEur ? (
                <>
                  <strong>€{plan.price.monthlyEur.toFixed(2)}</strong><span>/mese</span>
                  {typeof plan.price.firstMonthEur === "number" && plan.price.firstMonthEur < plan.price.monthlyEur && (
                    <div className="pricing-plan-discount">
                      Primo mese: <strong>€{plan.price.firstMonthEur.toFixed(2)}</strong> (sconto creazione)
                    </div>
                  )}
                </>
              ) : (
                <>
                  <strong>€{plan.price.oneShotEur}</strong><span>una tantum</span>
                  {typeof plan.price.oneShotEurDiscounted === "number" && plan.price.oneShotEurDiscounted < plan.price.oneShotEur && (
                    <div className="pricing-plan-discount">
                      Tu paghi: <strong>€{plan.price.oneShotEurDiscounted.toFixed(2)}</strong> (sconto creazione)
                    </div>
                  )}
                </>
              )}
            </div>
            <ul className="pricing-plan-features">
              {plan.features.map((f) => <li key={f}>{f}</li>)}
            </ul>
            {app.lifecycle === plan.key ? (
              <span className="pricing-plan-current">✓ Piano attualmente attivo</span>
            ) : (
              <button className="primary compact" onClick={() => onPurchaseTier(app.id, plan.key)}>
                {plan.cta}
              </button>
            )}
          </article>
        ))}
      </div>
      <p className="pricing-footnote">* In modalità sandbox il pagamento è simulato. La conferma sblocca il piano immediatamente. PayPal Live disponibile a breve.</p>
    </section>
  );
}

// Vista "stiamo analizzando": mostrata mentre il SDD gira, prima del preventivo.
// Status app: estimate_pending + autopilot.running. Spiega all'utente in maniera
// chiara che NON sta succedendo nulla di costoso e che il prezzo arrivera' presto.
function AnalyzingView({ app, onBackToProjects }) {
  const log = Array.isArray(app?.autopilot?.log)
    ? app.autopilot.log.slice(-3)
    : [];
  return (
    <div className="estimate-view">
      <button className="back-link" onClick={onBackToProjects}>← Torna al workspace</button>
      <div className="estimate-card analyzing-card">
        <div className="estimate-header">
          <div className="analyzing-orb">
            <Sparkles size={28} className="spin-slow" />
            <div className="analyzing-orb-pulse" />
          </div>
          <h1>Stiamo analizzando la tua idea</h1>
          <p className="estimate-subtitle">
            Il sistema sta studiando il tuo prompt per capire la complessità e calcolare il prezzo finale.
            <br />Ci vogliono circa 1-2 minuti.
            <br /><strong>Nessun addebito</strong> — vedrai il preventivo prima di decidere.
          </p>
        </div>
        <div className="analyzing-steps">
          <div className="analyzing-step done"><span>✓</span> App creata in workspace</div>
          <div className="analyzing-step active"><span className="dot-pulse" /> Analisi requisiti e complessità</div>
          <div className="analyzing-step"><span /> Preventivo pronto</div>
          <div className="analyzing-step"><span /> Generazione (solo dopo conferma)</div>
        </div>
        {log.length > 0 && (
          <div className="analyzing-log">
            {log.map((entry, i) => (
              <div key={i} className="analyzing-log-line">
                <span className="analyzing-log-time">{formatShortTime(entry.at)}</span>
                <span>{(entry.message || "").slice(0, 110)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// Vista preventivo: mostrata quando app.paymentFlow.status === "awaiting_payment".
// L'utente vede prezzo, breakdown della complessita', riepilogo cosa verra' creato
// e decide: conferma (paga sandbox/PayPal) o annulla (nessun addebito).
function EstimateView({ app, busy, onConfirmPayment, onCancelEstimate, onBackToProjects }) {
  // Opt-in email "app pronta": chiesto qui, prima di pagare. La preferenza
  // viene passata a confirm-payment e salvata sull'app.
  const [notifyReady, setNotifyReady] = useState(false);
  const pf = app?.paymentFlow || {};
  const price = Number(pf.priceEur || 0);
  const score = Number(pf.complexityScore || 0);
  const tier = pf.suggestedTier || "base";
  const breakdown = pf.breakdown || {};

  const signals = [];
  if (breakdown.hasAuth) signals.push({ icon: "🔐", label: "Login e registrazione utenti" });
  if (breakdown.hasDb) signals.push({ icon: "🗄️", label: "Database con tabelle" });
  if (breakdown.hasAdminPanel) signals.push({ icon: "🎛️", label: "Pannello di gestione" });
  if (breakdown.hasUpload) signals.push({ icon: "📤", label: "Upload file/immagini" });
  if (breakdown.hasMultiUser) signals.push({ icon: "👥", label: "Multi-utente con ruoli" });
  if (breakdown.hasPayments) signals.push({ icon: "💳", label: "Pagamenti integrati" });
  if (breakdown.hasIntegrations) signals.push({ icon: "🔌", label: "API esterne / webhook" });
  if (breakdown.hasRealtime) signals.push({ icon: "⚡", label: "Funzioni real-time" });

  return (
    <div className="estimate-view">
      <button className="back-link" onClick={onBackToProjects}>← Torna al workspace</button>

      <div className="estimate-card">
        <div className="estimate-header">
          <div className="estimate-badge">
            <Sparkles size={14} /> Analisi completata
          </div>
          <h1>Ecco il tuo preventivo</h1>
          <p className="estimate-subtitle">Abbiamo analizzato la tua idea. Decidi tu se proseguire — nessun addebito senza conferma.</p>
        </div>

        <div className="estimate-app-name">
          <span>App</span>
          <strong>{app?.name || "Senza nome"}</strong>
        </div>

        <div className="estimate-price-box">
          <span className="estimate-price-label">Costo creazione</span>
          <div className="estimate-price-amount">€{price.toFixed(2)}</div>
          <div className="estimate-price-discount">
            💚 <strong>Prova 48 ore inclusa.</strong> Se ti abboni o acquisti/esporti l'app, questi €{price.toFixed(2)} vengono scalati dal primo pagamento.
          </div>
        </div>

        <div className="estimate-section">
          <h3>Cosa creeremo</h3>
          {signals.length > 0 ? (
            <ul className="estimate-signals">
              {signals.map((s, i) => (
                <li key={i}><span className="estimate-signal-icon">{s.icon}</span> {s.label}</li>
              ))}
              {breakdown.taskCount ? (
                <li><span className="estimate-signal-icon">📋</span> {breakdown.taskCount} task pianificati</li>
              ) : null}
            </ul>
          ) : (
            <p className="estimate-empty-signals">App essenziale, struttura semplice.</p>
          )}
        </div>

        <label className="notify-mail-opt" style={{ display: "flex", gap: 10, alignItems: "center", margin: "16px 0", color: "#cbd5e1", fontSize: 14 }}>
          <input
            type="checkbox"
            checked={notifyReady}
            onChange={(e) => setNotifyReady(e.target.checked)}
          />
          <span>Avvisami via email quando l'app e' pronta e online (cosi' puoi chiudere il browser durante la generazione).</span>
        </label>

        <div className="estimate-actions">
          <button
            className="primary estimate-confirm"
            onClick={() => onConfirmPayment(app.id, { paymentMethod: "sandbox", notifyEmailOnReady: notifyReady })}
            disabled={busy}
          >
            {busy ? <><Sparkles size={16} className="spin" /> Conferma in corso…</> : <>💳 Paga €{price.toFixed(2)} e crea l'app</>}
          </button>
          <button
            className="secondary estimate-cancel"
            onClick={() => onCancelEstimate(app.id)}
            disabled={busy}
          >
            Annulla, nessun addebito
          </button>
        </div>

        <p className="estimate-footnote">
          💡 In modalità sandbox: il pagamento viene simulato per testare il flusso. PayPal Live disponibile a breve.
        </p>
      </div>
    </div>
  );
}

function ChatView({ app, chatPrompt, setChatPrompt, busy, status, error, onSend, onResume, onStop, onBackToProjects, onRequestLicense, onPurchaseTier }) {
  const [expandedPanel, setExpandedPanel] = useState(false);
  const [completedDetailsOpen, setCompletedDetailsOpen] = useState(false);
  const [previewVisible, setPreviewVisible] = useState(true);
  const [previewWidth, setPreviewWidth] = useState(() => {
    const saved = Number(localStorage.getItem(PREVIEW_WIDTH_KEY));
    return Number.isFinite(saved) ? clampPreviewWidth(saved) : 54;
  });
  const visibleMessages = conversationMessages(app?.messages || []);
  const taskState = app ? projectTaskState(app) : null;
  const projectComplete = isProjectComplete(app);
  const canResume =
    app && !app.autopilot?.running && !busy && (app.sdd?.currentStep || ["error", "partial", "paused"].includes(app.status));
  const canStop = app?.autopilot?.running || app?.status === "building";

  useEffect(() => {
    setCompletedDetailsOpen(false);
  }, [app?.id, projectComplete]);

  useEffect(() => {
    if (!expandedPanel) return undefined;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [expandedPanel]);

  useEffect(() => {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(previewWidth));
  }, [previewWidth]);

  function startPreviewResize(event) {
    if (window.matchMedia("(max-width: 980px)").matches) return;

    const layout = event.currentTarget.closest(".chat-layout");
    if (!layout) return;

    event.preventDefault();
    event.currentTarget.setPointerCapture?.(event.pointerId);
    const rect = layout.getBoundingClientRect();

    const onMove = (moveEvent) => {
      const next = ((rect.right - moveEvent.clientX) / rect.width) * 100;
      setPreviewWidth(clampPreviewWidth(next));
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp, { once: true });
  }

  function resizePreviewFromKeyboard(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setPreviewWidth((value) => clampPreviewWidth(value + (event.key === "ArrowLeft" ? 4 : -4)));
  }

  if (!app) {
    return (
      <div className="empty-state">
        <h1>Nessuna app selezionata</h1>
        <p>Crea un'app dal prompt iniziale per avviare il flusso LocoCode.</p>
      </div>
    );
  }

  if (projectComplete && !completedDetailsOpen) {
    const trialDaysLeft = app.trialDaysLeft;
    const trialExpired = trialDaysLeft !== null && trialDaysLeft === 0;
    // Mostra il banner prova SOLO se sta per scadere o e' gia scaduta.
    const showTrialBanner = app.lifecycle === "trial" && trialDaysLeft !== null && trialDaysLeft <= 7;

    const doneCount = taskState.doneCount ?? 0;
    return (
      <div className="completed-workspace">
        <article className="completed-project-row">
          <div className="completed-project-info">
            <div className="completed-project-badge">
              <Check size={13} />
              <span>Completato</span>
            </div>
            <strong className="completed-project-name">{app.name}</strong>
            <span className="completed-project-meta">{doneCount} task · {app.fileCount || 0} file generati</span>
            {app.appUrl && (
              <a className="completed-project-url" href={app.appUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={11} />
                {app.appUrl.replace(/^https?:\/\//, "")}
              </a>
            )}
          </div>
          <div className="completed-project-actions">
            {app.appUrl && (
              <a className="primary compact" href={app.appUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={14} />
                Apri app
              </a>
            )}
            <button className="secondary-action compact" onClick={() => setCompletedDetailsOpen(true)}>
              Gestisci
            </button>
            <button className="secondary-action compact icon-only" onClick={onBackToProjects} title="Torna al workspace">
              ‹ Workspace
            </button>
          </div>
        </article>
        {showTrialBanner && (
          <div className={`trial-banner ${trialExpired ? "expired" : ""} ${trialDaysLeft <= 1 ? "warning" : ""}`}>
            <div className="trial-banner-text">
              {trialExpired ? (
                <><strong>Prova terminata.</strong> L'app non è più accessibile pubblicamente. Attiva un abbonamento o acquista/esporta il codice per riabilitarla.</>
              ) : trialDaysLeft === 1 ? (
                <><strong>Ultime 24 ore di prova.</strong> Scegli un piano qui sotto per non perdere l'accesso.</>
              ) : (
                <><strong>Prova attiva</strong> — {trialDaysLeft} giorni rimanenti. Il costo di creazione verra scalato dal piano che scegli.</>
              )}
            </div>
          </div>
        )}
        <PricingCard app={app} onPurchaseTier={onPurchaseTier} />
      </div>
    );
  }

  return (
    <div className={`chat-layout${previewVisible ? "" : " preview-hidden"}`} style={{ "--preview-width": `${previewWidth}%` }}>
      <section className="chat-panel orchestrator-panel">
        <div className="orchestrator-strip">
          <div className={`task-card ${app.status === "error" ? "has-error" : ""}`}>
            <span>{taskState.kicker}</span>
            <strong>{taskState.label}</strong>
            <em>{taskState.meta}</em>
          </div>
          <div className="orchestrator-actions">
            {canResume && (
              <button className="secondary-action compact" disabled={busy} onClick={onResume}>
                Riprendi
              </button>
            )}
            {canStop && (
              <button className="secondary-action compact danger" disabled={busy} onClick={onStop}>
                Ferma
              </button>
            )}
            {projectComplete && (
              <button className="secondary-action compact" disabled={busy} onClick={() => setCompletedDetailsOpen(false)}>
                Chiudi dettagli
              </button>
            )}
            <button
              className="icon-only preview-toggle-btn"
              title={previewVisible ? "Nascondi anteprima" : "Mostra anteprima"}
              aria-label={previewVisible ? "Nascondi anteprima" : "Mostra anteprima"}
              onClick={() => setPreviewVisible((v) => !v)}
            >
              {previewVisible ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
        </div>

        <OperationLog app={app} status={status} error={error} compact />

        <div className="messages">
          {visibleMessages.map((message, index) => (
            <article key={`${message.at}-${index}`} className={`message ${message.role}`}>
              <p>{chatMessageContent(message)}</p>
            </article>
          ))}
          {!visibleMessages.length && <p className="messages-empty">Scrivi una richiesta o avvia il prossimo task.</p>}
        </div>

        <Composer
          value={chatPrompt}
          onChange={setChatPrompt}
          model={app.model}
          setModel={() => {}}
          busy={busy}
          placeholder="Chiedi una modifica all'app selezionata..."
          onSubmit={onSend}
          showModel={false}
        />
      </section>

      <div
        className="preview-resizer"
        role="separator"
        aria-label="Ridimensiona pannello"
        aria-orientation="vertical"
        tabIndex={0}
        onPointerDown={startPreviewResize}
        onKeyDown={resizePreviewFromKeyboard}
      />

      {previewVisible && (
        <section className="preview-panel">
          <div className="panel-title">
            <div>
              <span>Anteprima</span>
              <h2 className="panel-title-name">{app.name || "App"}</h2>
            </div>
            <div className="panel-actions">
              <button className="fullscreen-button icon-only" onClick={() => setExpandedPanel(true)} aria-label="Schermo intero" title="Schermo intero">
                <Maximize2 size={18} />
              </button>
              <button className="fullscreen-button icon-only" onClick={() => setPreviewVisible(false)} aria-label="Chiudi anteprima" title="Chiudi anteprima">
                <X size={18} />
              </button>
            </div>
          </div>
          <ProjectPanelContent projectPanel="preview" app={app} />
        </section>
      )}

      {expandedPanel && (
        <section
          className="fullscreen-panel fullscreen-preview-mode"
          role="dialog"
          aria-modal="true"
          aria-label="App"
          onWheel={(event) => event.stopPropagation()}
          onClick={(e) => { if (e.target === e.currentTarget) setExpandedPanel(false); }}
        >
          <div className="fullscreen-preview-wrap">
            <div className="fullscreen-preview-topbar">
              <div className="fullscreen-preview-appname">
                <span className="fullscreen-preview-dot" />
                <span>{app.name || "App"}</span>
              </div>
              <button className="fullscreen-preview-close" onClick={() => setExpandedPanel(false)} aria-label="Chiudi">
                <X size={18} />
              </button>
            </div>
            <ProjectPanelContent projectPanel="preview" app={app} fullscreen />
          </div>
        </section>
      )}
    </div>
  );
}

function OperationLog({ app, status, error, compact = false }) {
  const lastAssistant = [...(app.messages || [])].reverse().find((message) => message.role === "assistant");
  const report = app.autopilot?.error;
  const log = Array.isArray(app.autopilot?.log)
    ? app.autopilot.log
        .filter((entry) => isUsefulOperation(entry.message))
        .filter((entry, i, arr) => i === 0 || cleanOperationText(entry.message) !== cleanOperationText(arr[i - 1].message))
        .slice(compact ? -8 : -18)
    : [];
  const hasError = Boolean(error || report) || app.status === "error" || /errore|timeout|interrott/i.test(lastAssistant?.content || "");
  const taskState = projectTaskState(app);
  const text = cleanOperationText(error || report?.cause || lastAssistant?.content || "Nessuna operazione registrata per ora.");

  const ts = projectTaskState(app);
  const doneCount = ts.doneCount ?? 0;
  const remaining = ts.remaining ?? 0;
  const totalCount = doneCount + remaining;
  const fileCount = app?.fileCount || (Array.isArray(app?.files) ? app.files.length : 0);
  const progressPct = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;
  const showProgress = totalCount > 0;

  return (
    <section className={`operation-log ${compact ? "compact-log" : ""} ${hasError ? "has-error" : ""}`}>
      <div className="operation-head">
        <div>
          <strong>{compact ? "Avanzamento" : "Registro operativo"}</strong>
          <span>{taskState.short}</span>
        </div>
        <div className="operation-head-right">
          {fileCount > 0 && <span className="file-count-badge">{fileCount} file</span>}
          {app.autopilot?.running && <em className="live-badge">Live</em>}
        </div>
      </div>
      {showProgress && (
        <div className="progress-track">
          <div className="progress-bar" style={{ width: `${progressPct}%` }} />
          <span>{doneCount} ✓ · {remaining} rimasti</span>
        </div>
      )}
      <div className="operation-body">
        {report ? (
          <>
            <strong>{report.title || "Orchestrator fermo"}</strong>
            <p>{report.task ? `Task: ${report.task}` : text}</p>
            <p>{cleanOperationText(report.cause)}</p>
            {report.suggestion && <p>{cleanOperationText(report.suggestion)}</p>}
          </>
        ) : (
          <>
            {log.length ? (
              <ul className="operation-events">
                {log.map((entry, index) => (
                  <li key={`${entry.at}-${index}`}>
                    <time>{formatShortTime(entry.at)}</time>
                    <span>{cleanOperationText(entry.message, compact ? 200 : 420)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p>{text}</p>
            )}
            {status && app.autopilot?.running && <p className="status-live">{status}</p>}
          </>
        )}
      </div>
    </section>
  );
}

function ProjectPanelContent({ projectPanel, app, fullscreen = false }) {
  if (projectPanel === "preview") {
    return <BrowserPreview app={app} fullscreen={fullscreen} />;
  }

  if (projectPanel === "sdd") return <SddDocumentsPanel app={app} fullscreen={fullscreen} />;
  if (projectPanel === "files") return <FilesPanel app={app} />;
  return <SddDocumentsPanel app={app} fullscreen={fullscreen} />;
}

// Preview stile Lovable/v0/Bolt: browser frame con URL bar, device toggle,
// e building state live durante la generazione.
function BrowserPreview({ app, fullscreen = false }) {
  const [device, setDevice] = useState("desktop"); // desktop | tablet | mobile
  const [iframeKey, setIframeKey] = useState(0);
  const previewUrl = app ? livePreviewUrl(app) : "";
  const isBuilding = app?.autopilot?.running || app?.status === "building";
  const buildVersion = app?.preview?.buildVersion || 0;
  const publicUrl = app?.appUrl || "";
  const displayUrl = publicUrl
    ? publicUrl.replace(/^https?:\/\//, "")
    : (isBuilding ? "in costruzione…" : "preview locale");

  const handleRefresh = () => setIframeKey((k) => k + 1);

  return (
    <div className={`browser-preview ${fullscreen ? "browser-preview-fullscreen" : ""}`}>
      <div className="browser-toolbar">
        <div className="browser-traffic-lights">
          <span className="browser-dot browser-dot-red" />
          <span className="browser-dot browser-dot-yellow" />
          <span className="browser-dot browser-dot-green" />
        </div>
        <div className={`browser-url-bar ${isBuilding ? "is-building" : ""}`}>
          {isBuilding ? <Sparkles size={11} className="spin-slow" /> : <Lock size={11} />}
          <span className="browser-url-text">{displayUrl}</span>
          {isBuilding && <span className="browser-url-progress" />}
        </div>
        <div className="browser-toolbar-actions">
          <div className="device-toggle">
            <button
              className={device === "desktop" ? "active" : ""}
              onClick={() => setDevice("desktop")}
              aria-label="Desktop"
              title="Desktop"
            >
              <Monitor size={14} />
            </button>
            <button
              className={device === "tablet" ? "active" : ""}
              onClick={() => setDevice("tablet")}
              aria-label="Tablet"
              title="Tablet"
            >
              <Tablet size={14} />
            </button>
            <button
              className={device === "mobile" ? "active" : ""}
              onClick={() => setDevice("mobile")}
              aria-label="Mobile"
              title="Mobile"
            >
              <Smartphone size={14} />
            </button>
          </div>
          <button
            className="browser-action-btn"
            onClick={handleRefresh}
            aria-label="Aggiorna"
            title="Aggiorna"
            disabled={!previewUrl}
          >
            <RotateCw size={14} />
          </button>
          {publicUrl && (
            <a
              className="browser-action-btn"
              href={publicUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="Apri in nuova scheda"
              title="Apri in nuova scheda"
            >
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </div>
      <div className={`browser-viewport device-${device}`}>
        <div className="browser-viewport-inner">
          {isBuilding && (!previewUrl || buildVersion === 0) ? (
            <BuildingState app={app} />
          ) : previewUrl ? (
            <iframe
              key={`${app.id}-v${buildVersion}-${iframeKey}-${app.preview?.hasLiveBuild ? "live" : "fallback"}`}
              title="App"
              src={previewUrl}
            />
          ) : (
            <iframe title="App" srcDoc={emptyPreviewHtml()} />
          )}
        </div>
      </div>
    </div>
  );
}

// Stato di caricamento durante la generazione: mostra l'attività live
// (ultimi 5 messaggi del log autopilot) come un terminale stile Bolt.
function BuildingState({ app }) {
  const taskState = projectTaskState(app);
  const log = Array.isArray(app?.autopilot?.log)
    ? app.autopilot.log
        .filter((entry) => isUsefulOperation(entry.message))
        .filter((entry, i, arr) => i === 0 || cleanOperationText(entry.message) !== cleanOperationText(arr[i - 1].message))
        .slice(-5)
    : [];
  const fileCount = app?.fileCount || (Array.isArray(app?.files) ? app.files.length : 0);
  return (
    <div className="building-state">
      <div className="building-orb">
        <div className="building-orb-pulse" />
        <Sparkles size={28} className="spin-slow" />
      </div>
      <h3 className="building-title">Stiamo costruendo la tua app</h3>
      <p className="building-subtitle">{taskState.short || "Pianificazione in corso…"}</p>
      {fileCount > 0 && (
        <div className="building-files-badge">
          <FileCode size={12} /> {fileCount} file creati finora
        </div>
      )}
      {log.length > 0 && (
        <div className="building-log">
          {log.map((entry, i) => (
            <div className="building-log-line" key={`${entry.at}-${i}`} style={{ opacity: 0.3 + (i / log.length) * 0.7 }}>
              <span className="building-log-time">{formatShortTime(entry.at)}</span>
              <span className="building-log-text">{cleanOperationText(entry.message, 90)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function panelTitle(projectPanel, app) {
  if (projectPanel === "sdd") return "Piano progetto";
  if (projectPanel === "files") return "File progetto";
  return app.status === "building" ? "Generazione in corso" : "App";
}

function isProjectComplete(app) {
  const steps = app?.sdd?.steps || [];
  if (!steps.length) return false;
  return !app?.sdd?.currentStep && steps.every((step) => step.done);
}

function projectTaskState(app) {
  if (!app) {
    return {
      header: "Nessuna app selezionata",
      kicker: "Stato",
      label: "Nessuna app selezionata",
      meta: "",
      short: "Pronto",
      doneCount: 0,
      remaining: 0,
    };
  }

  const steps = app?.sdd?.steps || [];
  const doneCount = steps.filter((step) => step.done).length;
  const remaining = steps.filter((step) => !step.done).length;
  const total = steps.length;
  const currentStep = app?.sdd?.currentStep || steps.find((step) => !step.done) || null;
  const planCompleted = total > 0 && remaining === 0;

  // Indice sequenziale (1-based) del task corrente nell'INTERO piano.
  // Sostituisce le numerazioni gerarchiche tipo "1.1, 2.1, 1.2" che confondono.
  const currentTaskIndex = currentStep
    ? steps.findIndex((s) => s.id === currentStep.id) + 1
    : 0;

  // Fase completa (es. "Fase 4 - Polish e Deploy") senza accorciare
  const phase = planCompleted ? "Completato" : formatPhaseLabel(currentStep?.phase || app?.sdd?.phase || "");
  const shortPhase = compactPhaseLabel(phase);

  // Contatore stabile: completati + rimanenti (non X/Y che oscilla)
  const progressText = total
    ? doneCount === total
      ? `${total} task completati`
      : `${doneCount} completati · ${remaining} rimanenti`
    : "In preparazione";

  // Strip numeric/letter prefixes like "4.4 - ", "T19: ", "2.3.", "1) " from task labels
  const rawTask = app?.autopilot?.currentTask || currentStep?.label || "";
  const task = rawTask.replace(/^\s*[A-Za-z]?\d+(\.\d+)*\s*[-.:)]\s*/, "").trim() || rawTask;
  // meta: solo fase + posizione task (es. "Fase 3 - Frontend · Task 8 di 22")
  const positionText = total && currentTaskIndex > 0
    ? `Task ${currentTaskIndex} di ${total}`
    : "";
  const meta = total
    ? positionText
      ? `${phase} · ${positionText}`
      : phase
    : "";
  // Header: fase + posizione + task corrente
  const headerMeta = total
    ? task
      ? `${phase} · ${positionText ? positionText + " · " : ""}${task}`
      : phase
    : "Piano in preparazione";

  if (app.status === "error") {
    return {
      header: `Fermo — ${headerMeta}`,
      kicker: "Errore da correggere",
      label: task || "Task non completato",
      meta,
      short: `${shortPhase} — errore`,
      doneCount,
      remaining,
    };
  }

  if (app.autopilot?.running || app.status === "building") {
    return {
      header: `${headerMeta}`,
      kicker: "Task corrente",
      label: task || "Preparazione piano",
      meta,
      short: `${shortPhase}`,
      doneCount,
      remaining,
    };
  }

  // Progetto completato: non mostrare "Completato · Completato" anche se autopilot.currentTask residuo
  if (planCompleted) {
    return {
      header: `${total} task completati`,
      kicker: "Piano completato",
      label: "Tutti i task completati",
      meta: progressText,
      short: "Completato",
      doneCount,
      remaining,
    };
  }

  if (task) {
    return {
      header: `${headerMeta}`,
      kicker: "Prossimo task",
      label: task,
      meta,
      short: app.status === "partial" || app.status === "paused" ? `${shortPhase} — in pausa` : `${shortPhase} — pronto`,
      doneCount,
      remaining,
    };
  }

  return {
    header: total ? `Piano completato — ${total} task` : "In attesa del piano",
    kicker: total ? "Piano completato" : "Piano in preparazione",
    label: total ? "Tutti i task completati" : "In attesa del primo prompt",
    meta: progressText,
    short: total ? "Completato" : "Pronto",
    doneCount,
    remaining,
  };
}

function formatPhaseLabel(value) {
  // Restituisce il nome completo della fase (es. "Fase 4 - Polish e Deploy")
  const text = String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .replace(/[✓✔]/g, "")
    .replace(/\s*[-–:]\s*$/, "")  // rimuove trattino/due punti finali
    .replace(/\s+/g, " ")
    .trim();

  return text || "In preparazione";
}

function compactPhaseLabel(value) {
  // Versione breve: solo "Fase N" per spazi ridotti
  const text = formatPhaseLabel(value);
  const match = text.match(/fase\s+\d+/i);
  return match ? match[0].replace(/^fase/i, "Fase") : (text.slice(0, 20) || "Fase");
}

function conversationMessages(messages) {
  const list = Array.isArray(messages) ? messages : [];
  return list.slice(-12);
}

function chatMessageContent(message) {
  const text = String(message?.content || "").trim();
  if (!text) return "";
  if (message.role !== "assistant") return text;

  return cleanOperationText(text, 700)
    .replace(/Prossimo task SDD applicato con\s+[\w./:-]+\.?\s*/i, "Task applicato. ")
    .replace(/Task SDD applicato con\s+[\w./:-]+\.?\s*/i, "Task applicato. ")
    .replace(/SDD creato e MVP iniziale generato con\s+[\w./:-]+\.?\s*/i, "Piano creato e prima versione funzionante generata. ")
    .replace(/Modifica applicata seguendo SDD con\s+[\w./:-]+\.?\s*/i, "Modifica applicata. ")
    .replace(/\bSDD\b/g, "piano")
    .replace(/File aggiornati:\s*[\s\S]*$/i, "File aggiornati salvati nel progetto.")
    .replace(/\n{3,}/g, "\n\n");
}

function cleanOperationText(value, maxChars = 360) {
  const text = String(value || "")
    .replace(/\s+/g, " ")
    // Strip task prefixes like "T20: ", "4.4 - ", "T19." at start of message
    .replace(/^[A-Za-z]?\d+(\.\d+)*\s*[-.:)]\s*/, "")
    .replace(/^Fase in corso:\s*/i, "")
    .replace(/^Avanzamento automatico:\s*/i, "")
    .replace(/\bAutopilota\b/g, "Avanzamento automatico")
    .replace(/\bautopilota\b/g, "avanzamento automatico")
    .replace(/\bTask SDD\b/g, "Task")
    .replace(/\btask SDD\b/g, "task")
    .replace(/\bPiano SDD\b/g, "Piano progetto")
    .replace(/\bpiano SDD\b/g, "piano progetto")
    .replace(/\s+con\s+deepseek\/deepseek-v4-pro/gi, "")
    .replace(/\s+con\s+moonshotai\/kimi-k2\.6/gi, "")
    .replace(/\s+con\s+[\w/-]+@[\w.-]+/gi, "")
    .replace(/File aggiornati:\s*.+$/i, "File aggiornati.")
    .trim();

  if (text.length <= maxChars) return text;
  return `${text.slice(0, maxChars).trim()}...`;
}

function isUsefulOperation(value) {
  const text = String(value || "").trim();
  if (!text) return false;
  if (/^Nota operativa/i.test(text)) return false;
  if (/\[Browser\]|<--|-->|OMDB_API_KEY|API_KEY|bash\b|python\s+-|pip\s+install|cd\s+backend|FastAPI|SQLite|Vite|\.env|localhost|curl\b|npm\s+/i.test(text)) {
    return false;
  }
  return true;
}

function findLastIndex(list, predicate) {
  for (let index = list.length - 1; index >= 0; index -= 1) {
    if (predicate(list[index], index)) return index;
  }
  return -1;
}

function formatShortTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function WorkspaceShell({ app, title, subtitle, children }) {
  if (!app) {
    return (
      <div className="empty-state">
        <h1>Nessuna app selezionata</h1>
        <p>Seleziona un'app dal menu laterale.</p>
      </div>
    );
  }

  return (
    <section className="workspace-view">
      <div className="workspace-head">
        <div>
          <span>{app.name}</span>
          <h2>{title}</h2>
        </div>
        {subtitle && <p>{subtitle}</p>}
      </div>
      {children}
    </section>
  );
}

function cleanTaskLabel(label) {
  return String(label || "").replace(/^\s*[A-Za-z]?\d+(\.\d+)*\s*[-.:)]\s*/, "").trim() || String(label || "");
}

function enrichStepsWithPhase(steps) {
  // Raggruppa per fase e calcola posizione relativa alla fase
  const phaseMap = new Map();
  for (const step of steps) {
    const ph = step.phase || "";
    if (!phaseMap.has(ph)) phaseMap.set(ph, []);
    phaseMap.get(ph).push(step);
  }
  return steps.map((step) => {
    const phaseSteps = phaseMap.get(step.phase || "") || [];
    const phaseIndex = phaseSteps.findIndex((s) => s.id === step.id) + 1;
    return { ...step, phaseIndex, phaseTotal: phaseSteps.length, cleanLabel: cleanTaskLabel(step.label) };
  });
}

function TasksWorkspace({ app }) {
  const steps = app?.sdd?.steps || [];
  const [doneOpen, setDoneOpen] = useState(false);
  const [todoOpen, setTodoOpen] = useState(true);
  const enriched = enrichStepsWithPhase(steps);
  const doneSteps = enriched.filter((step) => step.done);
  const todoSteps = enriched.filter((step) => !step.done);
  const currentTask = todoSteps[0] || null;
  const currentPhase = formatPhaseLabel(currentTask?.phase || app?.sdd?.phase || "");

  return (
    <WorkspaceShell app={app} title="Task progetto" subtitle={steps.length ? `${doneSteps.length} completati su ${steps.length}` : "Il piano task verra creato da LocoCode."}>
      <div className="task-dashboard">
        <div className="task-summary-grid">
          <article>
            <span>Completati</span>
            <strong>{doneSteps.length}</strong>
          </article>
          <article>
            <span>Da fare</span>
            <strong>{todoSteps.length}</strong>
          </article>
          <article className="wide">
            <span>Fase attuale</span>
            <strong>{currentPhase}</strong>
          </article>
          <article>
            <span>Task nella fase</span>
            <strong>{currentTask ? `${currentTask.phaseIndex} di ${currentTask.phaseTotal}` : `${doneSteps.length > 0 ? "✓ tutti" : "—"}`}</strong>
          </article>
        </div>

        {currentTask && (
          <article className="current-task-summary">
            <span>Prossimo task · {currentPhase} · {currentTask.phaseIndex} di {currentTask.phaseTotal}</span>
            <strong>{currentTask.cleanLabel}</strong>
          </article>
        )}

        <TaskGroup title="Da fare" count={todoSteps.length} open={todoOpen} onToggle={() => setTodoOpen((value) => !value)}>
          {todoSteps.map((step, index) => (
            <TaskRow key={step.id} step={step} current={index === 0} />
          ))}
        </TaskGroup>

        <TaskGroup title="Completati" count={doneSteps.length} open={doneOpen} onToggle={() => setDoneOpen((value) => !value)}>
          {doneSteps.map((step) => (
            <TaskRow key={step.id} step={step} />
          ))}
        </TaskGroup>

        {!steps.length && (
          <div className="panel-empty">
            <strong>Nessun task disponibile</strong>
            <span>Quando il piano iniziale sara pronto, qui vedrai tutti i task da completare.</span>
          </div>
        )}
      </div>
    </WorkspaceShell>
  );
}

function TaskGroup({ title, count, open, onToggle, children }) {
  return (
    <section className={`task-group ${open ? "open" : ""}`}>
      <button className="task-group-toggle" onClick={onToggle}>
        <span>{title}</span>
        <em>{count}</em>
      </button>
      {open && <div className="task-group-body">{count ? children : <p>Nessun task in questa sezione.</p>}</div>}
    </section>
  );
}

function TaskRow({ step, current = false }) {
  const phaseShort = compactPhaseLabel(step.phase || "");
  const posLabel = step.phaseIndex ? `${phaseShort} · ${step.phaseIndex}/${step.phaseTotal}` : (step.done ? "Completato" : "Da fare");
  return (
    <article className={`task-list-row ${step.done ? "done" : ""} ${current ? "current" : ""}`}>
      <span>{step.phaseIndex ?? "–"}</span>
      <Check size={18} />
      <div>
        <strong>{step.cleanLabel || step.label}</strong>
        <em>{current ? `Prossimo · ${posLabel}` : step.done ? `Completato · ${posLabel}` : posLabel}</em>
      </div>
    </article>
  );
}

function SddWorkspace({ app }) {
  return (
    <WorkspaceShell app={app} title="Piano progetto" subtitle="Specifiche, requisiti, architettura e task.">
      <SddDocumentsPanel app={app} fullscreen />
    </WorkspaceShell>
  );
}

function FilesWorkspace({ app }) {
  return (
    <WorkspaceShell app={app} title="File progetto" subtitle="Tutti i file generati da LocoCode.">
      <FilesPanel app={app} />
    </WorkspaceShell>
  );
}

function LogWorkspace({ app, status, error, onClearLogs, busy }) {
  if (!app) {
    return (
      <WorkspaceShell app={null} title="Registro attività" subtitle="">
        <div className="panel-empty"><strong>Nessuna app selezionata</strong></div>
      </WorkspaceShell>
    );
  }

  const allLog = Array.isArray(app.autopilot?.log) ? app.autopilot.log : [];
  const steps = app?.sdd?.steps || [];
  const doneSteps = steps.filter((s) => s.done);
  const pendingSteps = steps.filter((s) => !s.done);

  // Raggruppa task completati per fase
  const phaseMap = new Map();
  for (const s of doneSteps) {
    const ph = s.phase || "Generale";
    if (!phaseMap.has(ph)) phaseMap.set(ph, []);
    phaseMap.get(ph).push(s.label);
  }

  const fileCount = app?.fileCount || (Array.isArray(app?.files) ? app.files.length : 0);
  const ts = projectTaskState(app);
  const hasError = Boolean(error || app.autopilot?.error) || app.status === "error";

  return (
    <WorkspaceShell app={app} title="Registro attività" subtitle={`${fileCount} file generati · ${doneSteps.length} task completati · ${pendingSteps.length} rimanenti`}>
      <div className="log-actions">
        <button className="secondary-action compact danger" disabled={busy || !app} onClick={onClearLogs}>
          Pulisci log
        </button>
      </div>

      {hasError && app.autopilot?.error && (
        <div className="log-error-banner">
          <strong>{app.autopilot.error.title || "Errore"}</strong>
          <p>{cleanOperationText(app.autopilot.error.cause, 400)}</p>
          {app.autopilot.error.suggestion && <p className="log-suggestion">{cleanOperationText(app.autopilot.error.suggestion, 300)}</p>}
        </div>
      )}

      <div className="log-two-col">
        {/* Colonna sinistra: timeline eventi */}
        <section className="log-timeline-section">
          <h3>Timeline eventi</h3>
          {allLog.length === 0 ? (
            <p className="log-empty">Nessun evento registrato ancora.</p>
          ) : (
            <ol className="log-timeline">
              {allLog.map((entry, i) => {
                const msg = cleanOperationText(entry.message, 300);
                const isPhase = /complet|avanzamento|anteprima|wireframe/i.test(msg);
                const isError = /errore|error|fallito|non valid/i.test(msg);
                return (
                  <li key={`${entry.at}-${i}`} className={`log-event${isPhase ? " log-event-phase" : ""}${isError ? " log-event-error" : ""}`}>
                    <time>{formatShortTime(entry.at)}</time>
                    <span>{msg}</span>
                  </li>
                );
              })}
            </ol>
          )}
        </section>

        {/* Colonna destra: task per fase */}
        <section className="log-tasks-section">
          <h3>Task completati {doneSteps.length > 0 && <em>{doneSteps.length}/{steps.length}</em>}</h3>
          {phaseMap.size === 0 ? (
            <p className="log-empty">Nessun task completato ancora.</p>
          ) : (
            <div className="log-phase-list">
              {[...phaseMap.entries()].map(([phase, labels]) => (
                <div key={phase} className="log-phase-group">
                  <strong>{formatPhaseLabel(phase)}</strong>
                  <ul>
                    {labels.map((label, i) => (
                      <li key={i}><Check size={12} /><span>{label}</span></li>
                    ))}
                  </ul>
                </div>
              ))}
              {pendingSteps.length > 0 && (
                <div className="log-phase-group log-phase-pending">
                  <strong>Da completare</strong>
                  <ul>
                    {pendingSteps.map((s, i) => (
                      <li key={i}><span className="pending-dot" /><span>{s.label}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
          {Array.isArray(app?.files) && app.files.length > 0 && (
            <div className="log-files-section">
              <h3>File nel progetto <em>{app.files.length}</em></h3>
              <ul className="log-file-list">
                {app.files.map((f) => (
                  <li key={f}><FileStack size={11} /><span>{f}</span></li>
                ))}
              </ul>
            </div>
          )}
        </section>
      </div>
    </WorkspaceShell>
  );
}

function SddDocumentsPanel({ app, fullscreen = false }) {
  const specs = app.sdd?.specs || {};
  const [selectedDocument, setSelectedDocument] = useState(0);
  const documents = [
    { title: "Piano", content: specs.sdd },
    { title: "Requisiti", content: specs.requirements },
    { title: "Architettura", content: specs.architecture },
    { title: "Task operativi", content: specs.tasks },
    { title: "Memoria progetto", content: specs.memory },
  ].filter((item) => String(item.content || "").trim());

  const activeDocument = documents[Math.min(selectedDocument, Math.max(documents.length - 1, 0))];

  if (!documents.length) {
    return (
      <section className="sdd-compact-panel">
        <div className="panel-empty">
          <strong>Piano non ancora generato</strong>
          <span>Quando avvii il primo prompt, qui vedrai specifiche, requisiti, architettura e task creati da LocoCode.</span>
        </div>
      </section>
    );
  }

  if (!fullscreen) {
    return (
      <section className="sdd-compact-panel">
        {documents.map((document) => (
          <article className="sdd-compact-card" key={document.title}>
            <strong>{document.title}</strong>
            <p>{compactExcerpt(document.content)}</p>
          </article>
        ))}
      </section>
    );
  }

  return (
    <section className="sdd-documents" onWheel={forwardWheelToSddReader}>
      <nav className="sdd-doc-nav" aria-label="Documenti progetto">
        {documents.map((document, index) => (
          <button
            key={document.title}
            className={index === selectedDocument ? "active" : ""}
            onClick={() => setSelectedDocument(index)}
          >
            {document.title}
          </button>
        ))}
      </nav>
        <article className="sdd-reader">
          <header>
            <span>Documento</span>
            <h3>{activeDocument.title}</h3>
          </header>
        <div className="sdd-readable">{renderSddContent(activeDocument.content)}</div>
      </article>
    </section>
  );
}

function forwardWheelToSddReader(event) {
  if (event.target.closest?.(".sdd-doc-nav")) return;
  const reader = event.currentTarget.querySelector(".sdd-readable");
  if (!reader) return;
  reader.scrollTop += event.deltaY;
  event.preventDefault();
}

function renderSddContent(content) {
  return String(content || "")
    .split(/\r?\n/)
    .map((line, index) => {
      const trimmed = line.trim();
      if (!trimmed) return <div className="sdd-space" key={index} />;

      const h1 = trimmed.match(/^#\s+(.+)/);
      if (h1) return <h2 key={index}>{cleanInlineMarkdown(h1[1])}</h2>;

      const h2 = trimmed.match(/^##\s+(.+)/);
      if (h2) return <h3 key={index}>{cleanInlineMarkdown(h2[1])}</h3>;

      const h3 = trimmed.match(/^###\s+(.+)/);
      if (h3) return <h4 key={index}>{cleanInlineMarkdown(h3[1])}</h4>;

      const checked = trimmed.match(/^[-*]\s+\[[xX]\]\s+(.+)/);
      if (checked) return <p className="sdd-task done" key={index}>{cleanInlineMarkdown(checked[1])}</p>;

      const unchecked = trimmed.match(/^[-*]\s+\[\s\]\s+(.+)/);
      if (unchecked) return <p className="sdd-task" key={index}>{cleanInlineMarkdown(unchecked[1])}</p>;

      const bullet = trimmed.match(/^[-*]\s+(.+)/);
      if (bullet) return <p className="sdd-bullet" key={index}>{cleanInlineMarkdown(bullet[1])}</p>;

      return <p key={index}>{cleanInlineMarkdown(trimmed)}</p>;
    });
}

function cleanInlineMarkdown(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/`/g, "")
    .trim();
}

function compactExcerpt(content) {
  return String(content || "")
    .replace(/[#*_`>-]/g, "")
    .replace(/\[[ xX]\]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 190) || "Documento in preparazione.";
}

function FilesPanel({ app }) {
  const files = app.files || [];
  const sourceLocked = app.sourceLocked !== false; // default a "locked" se non specificato
  const tierExportEur = app.pricing?.plans?.exported?.oneShotEur;
  const isExported = app.lifecycle === "exported";

  // Distinzione: meta-file sempre visibili, sorgenti gated
  const isMetaFile = (p) => p.startsWith(".lc/") || p === "README.md";
  const sourceCount = files.filter((f) => !isMetaFile(f)).length;
  const metaCount = files.filter((f) => isMetaFile(f)).length;

  return (
    <section className="file-browser">
      <div className="file-summary">
        <strong>{files.length} file</strong>
        <span>
          {isExported
            ? "Codice sorgente sbloccato — puoi scaricare l'archivio completo."
            : `${sourceCount} sorgenti bloccati · ${metaCount} specifiche pubbliche`}
        </span>
      </div>

      {sourceLocked && !isExported && (
        <div className="source-locked-banner">
          <div className="source-locked-icon">🔒</div>
          <div className="source-locked-text">
            <strong>Codice sorgente protetto</strong>
            <p>
              I file frontend e backend sono bloccati. Acquista il pacchetto <strong>Export self-host</strong>
              {tierExportEur ? <> a <strong>€{tierExportEur}</strong> una tantum</> : null} per sbloccare
              il download completo del codice. Le specifiche del progetto restano sempre consultabili sotto.
            </p>
          </div>
        </div>
      )}

      {isExported && (
        <div className="source-unlocked-banner">
          <div className="source-locked-icon">✓</div>
          <div className="source-locked-text">
            <strong>Codice sbloccato</strong>
            <p>Hai pieno accesso al sorgente di questa app. Puoi scaricare l'archivio completo.</p>
          </div>
          <a className="primary compact" href={`/api/apps/${app.id}/export`} download>
            Scarica ZIP
          </a>
        </div>
      )}

      <div className="file-list">
        {files.map((file) => {
          const meta = isMetaFile(file);
          const locked = !meta && !isExported;
          return (
            <div className={`file-row ${locked ? "file-row-locked" : ""}`} key={file}>
              <FileStack size={16} />
              <span>{file}</span>
              {locked && <span className="file-lock-badge">🔒 locked</span>}
              {meta && !isExported && <span className="file-meta-badge">spec</span>}
            </div>
          );
        })}
        {!files.length && (
          <div className="panel-empty">
            <strong>Nessun file generato</strong>
            <span>Quando avvii un'app, qui vedrai specifiche, frontend, backend, configurazioni e preview.</span>
          </div>
        )}
      </div>
    </section>
  );
}

function DataPanel({ app }) {
  const files = app.files || [];
  const hasBackend = files.some((file) => file.startsWith("backend/"));
  const hasSpec = Boolean(app.sdd?.specs?.architecture || app.sdd?.specs?.requirements);
  const databaseNote = extractDatabaseNote(app.sdd?.specs?.architecture || app.sdd?.specs?.requirements || "");

  return (
    <section className="data-panel">
      <div className="data-grid">
        <article>
          <Database size={22} />
          <strong>Database progetto</strong>
          <span>{hasBackend ? "Backend generato: pronto per schema e API." : "Sara creato quando LocoCode genera il backend."}</span>
        </article>
        <article>
          <FolderKanban size={22} />
          <strong>Workspace utente</strong>
          <span>In produzione saranno collegati a login, token o account utente.</span>
        </article>
        <article>
          <Workflow size={22} />
          <strong>Prompt e run</strong>
          <span>Ogni richiesta e ogni fase del progetto verranno salvate sul server.</span>
        </article>
        <article>
          <FileStack size={22} />
          <strong>File generati</strong>
          <span>Il server conservera versioni e contenuti dei file progetto.</span>
        </article>
      </div>

      <div className="data-note">
        <strong>{hasSpec ? "Note dati dalla specifica" : "Schema dati in attesa"}</strong>
        <p>{databaseNote || "Dopo la prima generazione, questa sezione mostrera database, tabelle/API previste e collegamento ai file backend."}</p>
      </div>
    </section>
  );
}

function SddPanel({ app }) {
  const [open, setOpen] = useState(false);
  const steps = app.sdd?.steps || [];
  const specPaths = app.sdd?.filePaths || [];
  const doneCount = steps.filter((step) => step.done).length;
  const planSummary = steps.length
    ? open
      ? "Dettaglio piano operativo"
      : `${doneCount} task completati su ${steps.length}`
    : "Piano in preparazione";

  return (
    <section className={`sdd-panel ${open ? "open" : "collapsed"}`}>
      <button className="sdd-toggle" onClick={() => setOpen((value) => !value)}>
        <div>
          <strong>Piano progetto</strong>
          <span>{planSummary}</span>
        </div>
        <em>{steps.length ? `${doneCount}/${steps.length}` : "Apri"}</em>
      </button>

      {open && (
        <>
          <div className="sdd-files">
            {specPaths.length ? specPaths.map((file) => <span key={file}>{file}</span>) : <span>Specifiche in preparazione</span>}
          </div>
          <div className="sdd-steps">
            {steps.slice(0, 8).map((step) => (
              <div key={step.id} className={`sdd-step ${step.done ? "done" : ""}`}>
                <span>{step.done ? <Check size={13} /> : ""}</span>
                <p>{step.label}</p>
              </div>
            ))}
            {!steps.length && <p className="sdd-empty">Il piano operativo comparira dopo la prima generazione.</p>}
          </div>
        </>
      )}
    </section>
  );
}

function SettingsView({ apiKey, setApiKey, model, setModel, onSave, onTest, apiCheck, sharedKeyInfo, currentUser, apps }) {
  const { available, using, trialDaysLeft, isSubscribed } = sharedKeyInfo || {};
  const trialExpired = trialDaysLeft !== null && trialDaysLeft === 0 && !isSubscribed;
  const trialActive = available && using && trialDaysLeft > 0 && !isSubscribed;
  const isAdmin = currentUser?.isAdmin === true;
  const hasUserApiPlan = Array.isArray(apps) && apps.some((a) => a.lifecycle === "hosted_user_api");
  // Solo admin o utenti con almeno un'app su piano "Hosting + chiavi tue"
  // possono effettivamente impostare/cambiare la propria API key.
  const canSetApiKey = isAdmin || hasUserApiPlan;

  return (
    <div className="settings-view">
      <section className="settings-card">
        <h1>Impostazioni</h1>

        {isAdmin && (
          <div className="shared-key-banner admin">
            <strong>👑 Account amministratore</strong> — accesso completo a configurazioni avanzate e tutti i tier di generazione.
          </div>
        )}

        {/* Chiavi servizi cloud */}
        {canSetApiKey ? (
          <label>
            La tua chiave servizi cloud {isAdmin ? <span className="settings-optional">(admin — accesso libero)</span> : <span className="settings-optional">(piano Hosting + chiavi tue)</span>}
            <input
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              type="password"
              placeholder={using ? "Lascia vuoto per usare quelle condivise" : "Incolla qui la tua chiave"}
            />
          </label>
        ) : (
          <div className="settings-readonly">
            <span className="settings-readonly-label">Chiavi servizi cloud</span>
            <span className="settings-readonly-value">Fornite da LocoCode</span>
          </div>
        )}

        {/* Modello: scelta solo admin, per non-admin info-only */}
        {isAdmin ? (
          <label>
            Modello predefinito <span className="settings-optional">(admin)</span>
            <ModelSelect value={model} onChange={setModel} />
          </label>
        ) : (
          <div className="settings-readonly">
            <span className="settings-readonly-label">Motore di generazione</span>
            <span className="settings-readonly-value">Determinato dal tier acquistato</span>
          </div>
        )}
        <label>
          Lingua interfaccia
          <select className="model-input" value="it" disabled>
            <option value="it">Italiano</option>
          </select>
        </label>
        <div className="settings-actions">
          {canSetApiKey && <button className="secondary-action" onClick={onTest}>Test API</button>}
          <button className="primary" onClick={onSave}>Salva impostazioni</button>
        </div>
        {apiCheck && <p className="api-check">{apiCheck}</p>}
      </section>
    </div>
  );
}

function HelpView() {
  const cards = [
    {
      icon: Plus,
      title: "1. Descrivi l'app",
      text: "Dai un nome all'app e scrivi cosa deve fare. LocoCode prepara il piano e costruisce una prima versione reale.",
    },
    {
      icon: Workflow,
      title: "2. Segui l'avanzamento",
      text: "Nel pannello Lavoro leggi cosa sta facendo, cosa ha completato e se serve un tuo intervento.",
    },
    {
      icon: LayoutDashboard,
      title: "3. Usa la tua app",
      text: "Quando la web app e pronta, la usi subito online. I dati si salvano nel database reale sul server.",
    },
  ];

  return (
    <div className="help-view">
      <section className="help-hero">
        <h1>Crea una web app</h1>
        <p>La tua app gira sul server con database reale. Puoi usarla subito e attivarla con una chiave definitiva quando vuoi.</p>
      </section>

      <section className="help-grid">
        {cards.map((card) => {
          const Icon = card.icon;
          return (
            <article className="help-card" key={card.title}>
              <Icon size={26} />
              <h2>{card.title}</h2>
              <p>{card.text}</p>
            </article>
          );
        })}
      </section>

      <section className="architecture-card help-simple-card">
        <h2>Dall'app all'abbonamento</h2>
        <p>L'app generata non viene buttata: diventa la base della tua app attiva con i tuoi dati reali e la tua configurazione, quando decidi di abbonarti.</p>
      </section>
    </div>
  );
}
function ModelSelect({ value, onChange, compact = false }) {
  const options = COMMON_MODELS.includes(value) ? COMMON_MODELS : [value, ...COMMON_MODELS].filter(Boolean);

  return (
    <select
      className={`model-input ${compact ? "compact" : ""}`}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      aria-label="Modello"
    >
      {options.map((item) => (
        <option key={item} value={item}>
          {modelLabel(item)}
        </option>
      ))}
    </select>
  );
}

function formatDate(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString("it-IT", { dateStyle: "short", timeStyle: "short" });
}

function livePreviewUrl(app) {
  // Usa sempre live-preview: costruisce il frontend se disponibile,
  // altrimenti serve il wireframe statico, altrimenti pending.
  const base = `/api/apps/${app?.id}/live-preview/`;
  const token = localStorage.getItem(SESSION_KEY) || "";
  if (!token) return `${API_BASE}${base}`;
  return `${API_BASE}${base}?preview_token=${encodeURIComponent(token)}`;
}

function emptyPreviewHtml() {
  return `<!doctype html><html lang="it"><head><meta charset="utf-8"><style>body{margin:0;min-height:100vh;display:grid;place-items:center;font-family:Inter,Arial,sans-serif;background:#09091a;color:#b0b8d8}.box{text-align:center;padding:28px}.box h1{margin:0 0 10px;font-size:26px;font-weight:700;color:#eaecf8}.box p{margin:0;color:#5c6585;font-size:15px;line-height:1.6}.dot{display:inline-flex;gap:6px;margin-top:18px}.dot span{width:7px;height:7px;border-radius:50%;background:#6366f1;animation:b 1.2s ease-in-out infinite}.dot span:nth-child(2){animation-delay:.2s}.dot span:nth-child(3){animation-delay:.4s}@keyframes b{0%,80%,100%{opacity:.2}40%{opacity:1}}</style></head><body><div class="box"><h1>App in costruzione</h1><p>LocoCode sta generando la tua app in tempo reale.</p><div class="dot"><span></span><span></span><span></span></div></div></body></html>`;
}

function modelLabel(model) {
  return MODEL_LABELS[model] || model || "DeepSeek V4 Pro";
}

function extractDatabaseNote(text) {
  const value = String(text || "").trim();
  if (!value) return "";

  const databaseIndex = value.toLowerCase().indexOf("database");
  const start = databaseIndex >= 0 ? databaseIndex : 0;
  return value
    .slice(start, start + 700)
    .replace(/[#*_`>-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function apiFetch(path, options) {
  const headers = new Headers(options?.headers || {});
  const token = localStorage.getItem(SESSION_KEY);
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  return fetch(`${API_BASE}${path}`, { ...(options || {}), headers });
}

async function readApiJson(response) {
  const text = await response.text();
  if (!text.trim()) return {};

  try {
    return JSON.parse(text);
  } catch {
    throw new Error(
      `Risposta API non valida (${response.status}). ${text.slice(0, 220) || "Il server ha risposto senza JSON."}`,
    );
  }
}
