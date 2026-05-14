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
  FileStack,
  FolderKanban,
  KeyRound,
  LayoutDashboard,
  LogOut,
  Mail,
  Maximize2,
  Plus,
  Search,
  Send,
  SlidersHorizontal,
  Sparkles,
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
    if (!window.confirm(`Eliminare il progetto "${appName}"?
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
    setError("Inserisci email e token per lavorare sui tuoi progetti.");
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

  async function generateApp({ text, appId = "", overrideModel = "", name = "" }) {
    if (!requireAuth()) return;
    const cleanPrompt = text.trim();
    if (!cleanPrompt || busy) return;
    const cleanProjectName = String(name || "").trim();
    if (!appId && !cleanProjectName) {
      setError("Inserisci un nome progetto prima di avviare la generazione.");
      setStatus("Nome progetto mancante");
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
          openrouterApiKey: apiKey,
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
    setApiCheck("Test OpenRouter in corso...");
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
            onGenerate={() => generateApp({ text: prompt, name: projectName })}
            onQuick={(item) => {
              setProjectName(item.label);
              setPrompt(item.prompt);
              void generateApp({ text: item.prompt, name: item.label });
            }}
          />
        )}

        {activeView === "chat" && (
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
      <NavButton icon={FolderKanban} label="Progetti" active={activeView === "projects"} onClick={() => setActiveView("projects")} />
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
        <h2>Accedi ai tuoi progetti</h2>
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
  return (
    <div className="projects-view">
      <section className="projects-card">
        <div className="projects-head">
          <div>
            <span>Area lavoro</span>
            <h1>Progetti</h1>
          </div>
          <button className="primary" onClick={() => setActiveView("apps")}>
            <Plus size={20} />
            <span>Nuovo progetto</span>
          </button>
        </div>
        <label className="project-search">
          <Search size={22} />
          <input value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} placeholder="Cerca progetti" />
        </label>

        <div className="project-grid">
          {!currentUser && (
            <button className="project-tile auth-item" onClick={onAuth}>
              <strong>Accedi con token</strong>
              <span>Inserisci email e token per vedere i tuoi progetti.</span>
            </button>
          )}
          {apps.map((app) => (
            <div
              key={app.id}
              className={`project-tile ${selectedApp?.id === app.id ? "selected" : ""}`}
              onClick={() => {
                setSelectedAppId(app.id);
                setActiveView("chat");
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { setSelectedAppId(app.id); setActiveView("chat"); } }}
            >
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
                  <button className="tile-icon-btn danger" title="Elimina progetto" onClick={(e) => { e.stopPropagation(); onDeleteApp(app.id, app.name); }}>
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            </div>
          ))}
          {currentUser && !apps.length && <p className="empty">Nessun progetto ancora.</p>}
        </div>
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
            ? "I tuoi progetti"
            : "Nuovo progetto";

  const viewLabel = {
    projects: "Progetti",
    apps: "Nuovo progetto",
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

function HomeView({ prompt, setPrompt, projectName, setProjectName, model, setModel, busy, onGenerate, onQuick }) {
  return (
    <div className="home-view">
      <section className="hero-block">
        <div className="hero-badge"><Sparkles size={12} /> AI App Builder</div>
        <h1>Crea la tua web app</h1>
        <p className="hero-sub">Descrivi cosa vuoi costruire — LocoCode genera backend, frontend e database pronti all'uso.</p>
        <label className="project-name-field">
          <span>Nome progetto</span>
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
          onSubmit={onGenerate}
        />
      </section>

        <div className="quick-row">
          {quickPrompts.map((item) => {
            const Icon = item.icon;
            return (
            <button key={item.label} onClick={() => onQuick(item)} disabled={busy}>
              <Icon size={22} />
              <span>{item.label}</span>
            </button>
            );
        })}
      </div>

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

function ChatView({ app, chatPrompt, setChatPrompt, busy, status, error, onSend, onResume, onStop, onBackToProjects, onRequestLicense }) {
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
        <h1>Nessun progetto selezionato</h1>
        <p>Crea un progetto dal prompt iniziale per avviare il flusso LocoCode.</p>
      </div>
    );
  }

  if (projectComplete && !completedDetailsOpen) {
    const trialDaysLeft = app.trialDaysLeft;
    const trialExpired = trialDaysLeft !== null && trialDaysLeft === 0;
    const showTrialBanner = app.lifecycle === "trial" && trialDaysLeft !== null;

    return (
      <div className="completed-workspace">
        <article className="completed-project-row">
          <div>
            <span>Progetto completato</span>
            <strong>{app.name}</strong>
            <em>{taskState.header}</em>
          </div>
          <div className="completed-project-actions">
            {app.appUrl && (
              <a className="secondary-action compact" href={app.appUrl} target="_blank" rel="noreferrer">
                Apri app
              </a>
            )}
            <button className="secondary-action compact" onClick={onBackToProjects}>
              Progetti
            </button>
            <button className="primary compact" onClick={() => setCompletedDetailsOpen(true)}>
              Apri dettagli
            </button>
          </div>
        </article>
        {showTrialBanner && (
          <div className={`trial-banner ${trialExpired ? "expired" : ""}`}>
            <div className="trial-banner-text">
              {trialExpired
                ? <><strong>Trial scaduto.</strong> L'app non è più accessibile pubblicamente.</>
                : <><strong>Trial attivo</strong> — {trialDaysLeft} {trialDaysLeft === 1 ? "giorno rimanente" : "giorni rimanenti"}. Dopo la scadenza l'accesso pubblico verrà bloccato.</>
              }
            </div>
            {!app.licenseRequested ? (
              <button className="primary compact" onClick={() => onRequestLicense(app.id)}>
                Richiedi licenza permanente
              </button>
            ) : (
              <span className="trial-requested">✓ Richiesta inviata</span>
            )}
          </div>
        )}
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
          placeholder="Chiedi una modifica al progetto selezionato..."
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
          className="fullscreen-panel"
          role="dialog"
          aria-modal="true"
          aria-label="App"
          onWheel={(event) => event.stopPropagation()}
        >
          <div className="fullscreen-card">
            <header>
              <div>
                <span>Anteprima</span>
                <h2>{app.name || "App"}</h2>
              </div>
              <button onClick={() => setExpandedPanel(false)} aria-label="Chiudi schermo intero">
                <X size={24} />
              </button>
            </header>
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
    const previewUrl = app ? livePreviewUrl(app) : "";

    return (
      <div className={`phone-preview ${fullscreen ? "phone-preview-fullscreen" : ""}`}>
        <div className="phone-device" aria-label="Applicazione">
          <div className="phone-screen">
            {previewUrl ? (
              <iframe
                key={`${app.id}-${app.status}-${app.preview?.hasLiveBuild ? "live" : "fallback"}`}
                className={fullscreen ? "fullscreen-iframe" : ""}
                title="App"
                src={previewUrl}
              />
            ) : (
              <iframe className={fullscreen ? "fullscreen-iframe" : ""} title="App" srcDoc={emptyPreviewHtml()} />
            )}
          </div>
        </div>
      </div>
    );
  }

  if (projectPanel === "sdd") return <SddDocumentsPanel app={app} fullscreen={fullscreen} />;
  if (projectPanel === "files") return <FilesPanel app={app} />;
  return <SddDocumentsPanel app={app} fullscreen={fullscreen} />;
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
      header: "Nessun progetto selezionato",
      kicker: "Stato",
      label: "Nessun progetto selezionato",
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
  // meta: solo fase — mostrata nell'em del task-card (no contatori che confondono)
  const meta = total ? phase : "";
  // Header: fase + task corrente
  const headerMeta = total
    ? task
      ? `${phase} · ${task}`
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
    .replace(/SDD creato e MVP iniziale generato con\s+[\w./:-]+\.?\s*/i, "Piano creato e MVP iniziale generato. ")
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
        <h1>Nessun progetto selezionato</h1>
        <p>Seleziona un progetto dal menu laterale.</p>
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
        <div className="panel-empty"><strong>Nessun progetto selezionato</strong></div>
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

  return (
    <section className="file-browser">
      <div className="file-summary">
        <strong>{files.length} file</strong>
        <span>Cartella progetto: {app.storagePath || "web/data/projects"}</span>
      </div>
      <div className="file-list">
        {files.map((file) => (
          <div className="file-row" key={file}>
            <FileStack size={16} />
            <span>{file}</span>
          </div>
        ))}
        {!files.length && (
          <div className="panel-empty">
            <strong>Nessun file generato</strong>
            <span>Quando avvii un progetto, qui vedrai specifiche, frontend, backend, configurazioni e preview.</span>
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
          <strong>Progetti utente</strong>
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

function SettingsView({ apiKey, setApiKey, model, setModel, onSave, onTest, apiCheck, sharedKeyInfo }) {
  const { available, using, trialDaysLeft, isSubscribed } = sharedKeyInfo || {};
  const trialExpired = trialDaysLeft !== null && trialDaysLeft === 0 && !isSubscribed;
  const trialActive = available && using && trialDaysLeft > 0 && !isSubscribed;

  return (
    <div className="settings-view">
      <section className="settings-card">
        <h1>Impostazioni</h1>

        {available && (
          <div className={`shared-key-banner ${trialExpired ? "expired" : trialActive ? "active" : "subscribed"}`}>
            {isSubscribed && <><strong>Abbonato</strong> — stai usando la chiave OpenRouter condivisa LocoCode.</>}
            {trialActive && <><strong>Trial attivo</strong> — chiave condivisa disponibile per {trialDaysLeft} {trialDaysLeft === 1 ? "giorno" : "giorni"} ancora. Nessuna configurazione richiesta.</>}
            {trialExpired && <><strong>Trial scaduto.</strong> Abbonati per continuare a usare la chiave condivisa, oppure inserisci la tua API key.</>}
            {!trialActive && !trialExpired && !isSubscribed && <>Chiave condivisa disponibile.</>}
          </div>
        )}

        <label>
          API key personale OpenRouter <span className="settings-optional">(opzionale — sovrascrive la chiave condivisa)</span>
          <input
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            type="password"
            placeholder={using ? "Lascia vuoto per usare la chiave condivisa" : "sk-or-..."}
          />
        </label>
        <label>
          Modello predefinito
          <ModelSelect value={model} onChange={setModel} />
        </label>
        <label>
          Lingua interfaccia
          <select className="model-input" value="it" disabled>
            <option value="it">Italiano</option>
          </select>
        </label>
        <div className="settings-actions">
          <button className="secondary-action" onClick={onTest}>Test API</button>
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
      text: "Dai un nome al progetto e scrivi cosa deve fare la web app. LocoCode prepara il piano e costruisce una prima versione reale.",
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
