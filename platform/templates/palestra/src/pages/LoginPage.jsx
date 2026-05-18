import { useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { mc } from "../lib/api.js";

export default function LoginPage({ onLoggedIn }) {
  const [email, setEmail] = useState("admin@palestra-demo.it");
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
    <div className="max-w-sm mx-auto mt-10 card p-6">
      <h1 className="text-xl font-bold mb-1">Accedi</h1>
      <p className="text-sm text-slate-500 mb-5">Palestra Demo · MelluCode</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="label">Email</label>
          <input className="input" type="email" autoFocus value={email}
                 onChange={(e) => setEmail(e.target.value)} required />
        </div>
        <div>
          <label className="label">Password</label>
          <input className="input" type="password" value={password}
                 onChange={(e) => setPassword(e.target.value)} required minLength={8} />
        </div>
        {error && <p className="text-sm text-rose-600">{error}</p>}
        <button type="submit" disabled={busy} className="btn-primary w-full justify-center">
          {busy ? "Accesso…" : "Accedi"}
        </button>
      </form>
      <p className="text-xs text-slate-400 mt-4">
        Demo: admin pre-seedato. Le credenziali sono comunicate fuori-banda.
      </p>
    </div>
  );
}
