import { useEffect, useMemo, useState } from "react";
import {
  AppWindow,
  Loader2,
  Mail,
  RefreshCcw,
  Search,
  Shield,
  Trash2,
  UserRound,
} from "lucide-react";
import { admin, formatDateIt } from "../lib/api.js";
import Modal from "../components/Modal.jsx";
import { useToast } from "../components/Toast.jsx";

function StatCard({ label, value, icon: Icon }) {
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-xs uppercase tracking-wider text-zinc-500 font-medium">{label}</span>
        <Icon className="w-4 h-4 text-accent-300" />
      </div>
      <div className="mt-2 font-display text-3xl font-semibold text-white tabular-nums">{value}</div>
    </div>
  );
}

function EmptyLine({ children }) {
  return (
    <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] px-4 py-6 text-sm text-zinc-500">
      {children}
    </div>
  );
}

export default function AdminPage({ user }) {
  const toast = useToast();
  const [users, setUsers] = useState([]);
  const [apps, setApps] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [mailTarget, setMailTarget] = useState(null);
  const [mailSubject, setMailSubject] = useState("");
  const [mailText, setMailText] = useState("");
  const [sending, setSending] = useState(false);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [u, t] = await Promise.all([admin.users(), admin.tenants()]);
      setUsers(u.users || []);
      setApps(t.tenants || []);
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  const filteredUsers = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return users;
    return users.filter((item) =>
      item.email?.toLowerCase().includes(q) ||
      item.name?.toLowerCase().includes(q)
    );
  }, [users, query]);

  const filteredApps = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return apps;
    return apps.filter((item) =>
      item.name?.toLowerCase().includes(q) ||
      item.slug?.toLowerCase().includes(q) ||
      item.owner?.email?.toLowerCase().includes(q)
    );
  }, [apps, query]);

  function openMail(target) {
    setMailTarget(target);
    setMailSubject("Aggiornamento MelluCode");
    setMailText("");
  }

  async function sendMail(e) {
    e.preventDefault();
    if (!mailTarget) return;
    setSending(true);
    try {
      await admin.sendUserEmail(mailTarget.id, { subject: mailSubject, text: mailText });
      toast.success(`Email inviata a ${mailTarget.email}.`);
      setMailTarget(null);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSending(false);
    }
  }

  async function deleteUser(target) {
    if (target.id === user?.id) {
      toast.error("Non puoi eliminare l'account admin con cui sei entrato.");
      return;
    }
    const ok = window.confirm(`Eliminare l'utente ${target.email} e tutte le sue app?`);
    if (!ok) return;
    try {
      await admin.deleteUser(target.id);
      toast.success(`Utente ${target.email} eliminato.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function deleteApp(target) {
    const ok = window.confirm(`Eliminare l'app "${target.name}" di ${target.owner?.email || "utente sconosciuto"}?`);
    if (!ok) return;
    try {
      await admin.deleteTenant(target.id);
      toast.success(`App "${target.name}" eliminata.`);
      await load();
    } catch (err) {
      toast.error(err.message);
    }
  }

  if (user?.role !== "admin") {
    return (
      <div className="card p-6 max-w-xl mx-auto">
        <div className="flex items-center gap-3">
          <Shield className="w-5 h-5 text-rose-300" />
          <div>
            <h1 className="text-xl font-semibold text-white">Area riservata</h1>
            <p className="text-sm text-zinc-400 mt-1">Questa sezione e' disponibile solo per l'amministratore MelluCode.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-6xl mx-auto space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-5">
        <div>
          <p className="text-sm uppercase tracking-[0.22em] text-accent-300 font-medium">Admin MelluCode</p>
          <h1 className="mt-2 text-gradient text-4xl sm:text-5xl font-semibold">Gestione piattaforma</h1>
          <p className="mt-3 text-zinc-400 max-w-2xl">
            Da qui controlli utenti registrati, app create, comunicazioni e cancellazioni. L'utente normale non vede nulla di questa sezione.
          </p>
        </div>
        <button type="button" onClick={load} className="btn-secondary" disabled={loading}>
          {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCcw className="w-4 h-4" />}
          Aggiorna
        </button>
      </div>

      <div className="grid sm:grid-cols-3 gap-3">
        <StatCard icon={UserRound} label="Utenti registrati" value={users.length} />
        <StatCard icon={AppWindow} label="App create" value={apps.length} />
        <StatCard icon={Shield} label="Admin" value={users.filter((u) => u.role === "admin").length} />
      </div>

      <div className="relative">
        <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
        <input
          className="input pl-10"
          placeholder="Cerca per email, nome app o indirizzo..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
      </div>

      {error && (
        <div className="rounded-xl border border-rose-400/20 bg-rose-500/10 p-4 text-sm text-rose-100">{error}</div>
      )}

      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">Utenti</h2>
            <p className="text-sm text-zinc-500">Puoi scrivere agli utenti o rimuoverli dalla piattaforma.</p>
          </div>
        </div>
        {loading ? (
          <EmptyLine>Carico utenti...</EmptyLine>
        ) : filteredUsers.length === 0 ? (
          <EmptyLine>Nessun utente trovato.</EmptyLine>
        ) : (
          <div className="space-y-2">
            {filteredUsers.map((item) => (
              <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-100 truncate">{item.email}</span>
                    {item.role === "admin" && <span className="pill-accent">admin</span>}
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    {item.name || "Senza nome"} - {item.tenantsCount} app - iscritto {formatDateIt(item.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" className="btn-secondary btn-sm" onClick={() => openMail(item)}>
                    <Mail className="w-3.5 h-3.5" /> Scrivi
                  </button>
                  <button type="button" className="btn-danger btn-sm" onClick={() => deleteUser(item)}>
                    <Trash2 className="w-3.5 h-3.5" /> Elimina
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="card p-5 sm:p-6">
        <div className="flex items-center justify-between gap-4 mb-4">
          <div>
            <h2 className="text-lg font-semibold text-white">App degli utenti</h2>
            <p className="text-sm text-zinc-500">Vista globale di tutte le web app create su MelluCode.</p>
          </div>
        </div>
        {loading ? (
          <EmptyLine>Carico app...</EmptyLine>
        ) : filteredApps.length === 0 ? (
          <EmptyLine>Nessuna app trovata.</EmptyLine>
        ) : (
          <div className="space-y-2">
            {filteredApps.map((item) => (
              <div key={item.id} className="rounded-xl border border-white/[0.06] bg-white/[0.025] px-4 py-3 flex flex-col md:flex-row md:items-center gap-3">
                <div className="flex-1 min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-zinc-100 truncate">{item.name}</span>
                    <span className="pill-neutral">{item.plan}</span>
                    <span className={item.status === "active" ? "pill-success" : "pill-danger"}>{item.status}</span>
                  </div>
                  <div className="text-xs text-zinc-500 mt-1">
                    /apps/{item.slug} - {item.owner?.email || "owner sconosciuto"} - creata {formatDateIt(item.createdAt)}
                  </div>
                </div>
                <button type="button" className="btn-danger btn-sm" onClick={() => deleteApp(item)}>
                  <Trash2 className="w-3.5 h-3.5" /> Elimina app
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <Modal
        open={Boolean(mailTarget)}
        onClose={() => setMailTarget(null)}
        title="Scrivi all'utente"
        subtitle={mailTarget ? `Invio a ${mailTarget.email}` : ""}
        maxWidth="lg"
      >
        <form onSubmit={sendMail} className="space-y-4">
          <div>
            <label className="label">Oggetto</label>
            <input
              className="input"
              value={mailSubject}
              onChange={(e) => setMailSubject(e.target.value)}
              required
              maxLength={200}
            />
          </div>
          <div>
            <label className="label">Messaggio</label>
            <textarea
              className="textarea min-h-[180px]"
              value={mailText}
              onChange={(e) => setMailText(e.target.value)}
              required
              placeholder="Scrivi qui il messaggio da inviare all'utente..."
            />
          </div>
          <div className="-mx-5 sm:-mx-6 -mb-5 px-5 sm:px-6 py-4 border-t border-white/[0.06] bg-ink-900/95 backdrop-blur-xl flex items-center justify-end gap-2">
            <button type="button" onClick={() => setMailTarget(null)} className="btn-ghost">Annulla</button>
            <button type="submit" className="btn-primary" disabled={sending}>
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Mail className="w-4 h-4" />}
              Invia email
            </button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
