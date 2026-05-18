import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { ArrowRight, Lock, Mail, Loader2 } from "lucide-react";
import { mc, APP_NAME, APP_SUBTITLE, PRIMARY_ENTITY_LABEL_PLURAL } from "../lib/api.js";
import Logo from "../components/Logo.jsx";

export default function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const navigate = useNavigate();
  const loc = useLocation();
  const next = loc.state?.from || "/";

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await mc.auth.login({ email, password });
      if (onLoggedIn) await onLoggedIn();
      navigate(next, { replace: true });
    } catch (err) {
      setError(err.message || "Credenziali non valide.");
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

        <Logo size={32} />

        <div className="space-y-6 animate-rise-slow max-w-md">
          <h1 className="font-display font-semibold text-5xl xl:text-6xl tracking-tighter2 leading-[1.05] text-gradient">
            {APP_NAME}
          </h1>
          {APP_SUBTITLE && (
            <p className="text-lg text-ink-300 leading-relaxed">
              {APP_SUBTITLE}
            </p>
          )}
        </div>

        <p className="text-xs text-ink-500 font-mono">
          powered by <span className="text-gradient-accent">MelluCode</span>
        </p>
      </section>

      {/* ---------- RIGHT: form ---------- */}
      <section className="flex items-center justify-center p-6 sm:p-10 min-h-screen">
        <div className="w-full max-w-sm animate-rise">
          <div className="lg:hidden mb-8 flex justify-center">
            <Logo size={32} />
          </div>

          <div className="mb-8">
            <h2 className="font-display text-3xl font-semibold tracking-tightish">Accedi</h2>
            <p className="text-sm text-ink-400 mt-1.5">
              Pannello {PRIMARY_ENTITY_LABEL_PLURAL?.toLowerCase() || "gestione"}.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="field">
              <label className="label">Email</label>
              <div className="relative">
                <Mail className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  className="input pl-10"
                  type="email" autoFocus required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="tu@dominio.it"
                />
              </div>
            </div>

            <div className="field">
              <label className="label">Password</label>
              <div className="relative">
                <Lock className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-ink-400" />
                <input
                  className="input pl-10"
                  type="password" required minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
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
                <><Loader2 className="w-4 h-4 animate-spin" /> Accesso…</>
              ) : (
                <>Accedi <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5" /></>
              )}
            </button>
          </form>
        </div>
      </section>
    </div>
  );
}
