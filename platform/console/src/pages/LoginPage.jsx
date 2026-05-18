import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowRight, Lock, Mail, User, Loader2, Sparkles, Zap, Shield, Database } from "lucide-react";
import { auth } from "../lib/api.js";
import Logo from "../components/Logo.jsx";

const FEATURES = [
  { Icon: Database, label: "Dati pronti" },
  { Icon: Shield,   label: "Utenti e accessi" },
  { Icon: Zap,      label: "AI con credito controllato" },
];

export default function LoginPage({ onLoggedIn }) {
  const [mode, setMode] = useState("login"); // "login" | "register"
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const loc = useLocation();
  const next = loc.state?.from || "/";

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true); setError(null);
    try {
      if (mode === "login") {
        await auth.login({ email, password });
      } else {
        await auth.register({ email, password, name: name?.trim() || undefined });
      }
      if (onLoggedIn) await onLoggedIn();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || "Errore di autenticazione.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid lg:grid-cols-2 min-h-screen gap-0 -mx-5 sm:-mx-8 -my-8 sm:-my-10">
      {/* ---------- LEFT: brand pitch ---------- */}
      <section className="hidden lg:flex relative flex-col justify-between p-12 overflow-hidden">
        <div className="absolute inset-0 -z-10">
          <div className="absolute -top-24 -left-16 w-[40rem] h-[40rem] bg-aurora-1 blur-[120px] opacity-90 animate-aurora" />
          <div className="absolute bottom-0 right-0 w-[28rem] h-[28rem] bg-aurora-2 blur-[100px] opacity-80 animate-aurora [animation-delay:-6s]" />
          <div className="absolute inset-0 bg-grid opacity-30" />
        </div>

        <Logo size={34} />

        <div className="space-y-7 max-w-md animate-rise-slow">
          <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/[0.06] border border-white/[0.08] text-xs text-zinc-300">
            <Sparkles className="w-3 h-3 text-accent-400" />
            Beta privata - prime app in prova
          </span>
          <h1 className="font-display font-semibold text-5xl xl:text-6xl tracking-tighter2 leading-[1.04] text-gradient">
            La tua app web,<br />
            <span className="text-gradient-accent">deployata in minuti.</span>
          </h1>
          <p className="text-lg text-zinc-400 leading-relaxed">
            Descrivi cosa vuoi creare: MelluCode prepara una web app
            <span className="text-white font-medium"> pronta da provare</span>, con utenti,
            dati, file e AI quando serve. Niente server da configurare.
          </p>

          <ul className="space-y-3 pt-2">
            {FEATURES.map(({ Icon, label }) => (
              <li key={label} className="flex items-center gap-3 text-sm text-zinc-300">
                <div className="grid place-items-center w-8 h-8 rounded-lg bg-accent-500/10 border border-accent-500/20">
                  <Icon className="w-3.5 h-3.5 text-accent-300" />
                </div>
                {label}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-zinc-500 font-mono">
          mellucode.mellutecno.it · v0.1
        </p>
      </section>

      {/* ---------- RIGHT: form ---------- */}
      <section className="flex items-center justify-center p-6 sm:p-10 min-h-screen">
        <div className="w-full max-w-sm animate-rise">
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo size={32} />
          </div>

          {/* Mode tabs */}
          <div className="inline-flex p-1 rounded-xl bg-white/[0.04] border border-white/[0.06] mb-8">
            <button type="button"
              onClick={() => setMode("login")}
              className={`px-4 h-8 text-sm rounded-lg transition ${mode === "login" ? "bg-white/[0.08] text-white shadow-card" : "text-zinc-400 hover:text-zinc-200"}`}>
              Accedi
            </button>
            <button type="button"
              onClick={() => setMode("register")}
              className={`px-4 h-8 text-sm rounded-lg transition ${mode === "register" ? "bg-white/[0.08] text-white shadow-card" : "text-zinc-400 hover:text-zinc-200"}`}>
              Registrati
            </button>
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl font-semibold tracking-tightish">
              {mode === "login" ? "Bentornato" : "Crea il tuo account"}
            </h2>
            <p className="text-sm text-zinc-400 mt-1.5">
              {mode === "login"
                ? "Accedi alla console MelluCode."
                : "Niente carta, niente impegni. Inizia gratis."}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            {mode === "register" && (
              <div className="field">
                <label className="label">Nome (opzionale)</label>
                <div className="relative">
                  <User className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                  <input
                    className="input pl-10" type="text"
                    value={name} onChange={(e) => setName(e.target.value)}
                    placeholder="Antonio Mellucci"
                  />
                </div>
              </div>
            )}

            <div className="field">
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  className="input pl-10" type="email" required autoFocus
                  value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@dominio.it"
                />
              </div>
            </div>

            <div className="field">
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-zinc-500" />
                <input
                  className="input pl-10" type="password" required minLength={8}
                  value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder={mode === "register" ? "Almeno 8 caratteri" : "••••••••"}
                />
              </div>
            </div>

            {error && (
              <div className="px-3.5 py-2.5 rounded-xl bg-rose-500/10 border border-rose-400/20 text-sm text-rose-200">
                {error}
              </div>
            )}

            <button type="submit" disabled={busy} className="btn-primary btn-lg w-full group">
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin" />
                  {mode === "login" ? "Accesso…" : "Creo account…"}</>
              ) : (
                <>{mode === "login" ? "Accedi" : "Crea account"}
                  <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" />
                </>
              )}
            </button>
          </form>

          <p className="text-xs text-zinc-500 mt-6 text-center">
            Continuando accetti termini e privacy. Beta — feedback &gt;&nbsp;
            <a href="mailto:hello@mellucode.mellutecno.it" className="link">scrivici</a>.
          </p>
        </div>
      </section>
    </div>
  );
}
