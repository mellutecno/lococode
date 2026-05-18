import { useEffect, useState } from "react";
import { Copy, Check, KeyRound, Loader2, ShieldCheck, Eye, EyeOff, ExternalLink } from "lucide-react";
import { tenants, tenantUrl } from "../lib/api.js";
import { useToast } from "./Toast.jsx";

// Card "Accesso all'app": mostra email admin dell'app generata e permette
// di generare una nuova password. Risolve la confusione "non so se sono admin
// dell'app" che Antonio ha segnalato: il creator MelluCode non e' la stessa
// cosa dell'app-user admin dentro l'app (sono auth separate, multi-tenant).
export default function AppAdminCard({ tenant }) {
  const toast = useToast();
  const [admin, setAdmin] = useState(null);
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [revealed, setRevealed] = useState(null); // password mostrata una volta
  const [showRevealed, setShowRevealed] = useState(true);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await tenants.appAdmin(tenant.id);
      setAdmin(res?.admin || null);
    } catch (err) {
      // silenzioso
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (tenant?.id) load(); }, [tenant?.id]);

  async function handleReset() {
    if (!confirm("Generare una nuova password per l'admin dell'app? La vecchia non funzionera' piu'.")) return;
    setResetting(true);
    try {
      const res = await tenants.resetAppAdminPassword(tenant.id);
      setAdmin(res.admin);
      setRevealed(res.password);
      setShowRevealed(true);
      toast.success("Password rigenerata. Salvala adesso, non la rivedrai piu'.");
    } catch (err) {
      toast.error(err.message);
    } finally {
      setResetting(false);
    }
  }

  async function copyPassword() {
    if (!revealed) return;
    await navigator.clipboard.writeText(revealed);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (loading) {
    return (
      <div className="card p-5 flex items-center gap-3 text-xs text-zinc-500">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Carico accesso app…
      </div>
    );
  }

  const appUrl = tenant.metadata?.frontend?.url || tenantUrl(tenant.slug);

  return (
    <div className="card p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid place-items-center w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-400/20 flex-shrink-0">
            <ShieldCheck className="w-4 h-4 text-emerald-300" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white">Accesso amministratore</h3>
            <p className="text-[11px] text-zinc-500">Usa queste credenziali per entrare nella tua app.</p>
          </div>
        </div>
      </div>

      {admin ? (
        <>
          <div className="space-y-2.5">
            <div>
              <div className="text-[10px] uppercase tracking-wider text-zinc-500 mb-1">Email admin</div>
              <code className="text-sm text-zinc-100 font-mono break-all">{admin.email}</code>
            </div>

            {revealed ? (
              <div className="rounded-xl border border-emerald-400/30 bg-emerald-500/5 p-3">
                <div className="text-[10px] uppercase tracking-wider text-emerald-300 mb-1.5 flex items-center gap-1.5">
                  Nuova password — SALVALA, non la rivedrai
                </div>
                <div className="flex items-center gap-2">
                  <code className="flex-1 font-mono text-sm text-white break-all select-all">
                    {showRevealed ? revealed : "•".repeat(revealed.length)}
                  </code>
                  <button onClick={() => setShowRevealed((v) => !v)} className="btn-ghost btn-sm" title="Mostra/nascondi">
                    {showRevealed ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                  <button onClick={copyPassword} className="btn-ghost btn-sm" title="Copia">
                    {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-[11px] text-zinc-500 leading-relaxed">
                Per sicurezza la password non viene salvata in chiaro.
                Se l'hai dimenticata, puoi generarne una nuova.
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <a href={appUrl} target="_blank" rel="noreferrer" className="btn-secondary btn-sm">
              Apri l'app <ExternalLink className="w-3.5 h-3.5" />
            </a>
            <button onClick={handleReset} disabled={resetting} className="btn-secondary btn-sm">
              {resetting
                ? <><Loader2 className="w-3.5 h-3.5 animate-spin" /> Genero…</>
                : <><KeyRound className="w-3.5 h-3.5" /> Genera nuova password</>}
            </button>
          </div>
        </>
      ) : (
        <>
          <p className="text-sm text-zinc-300">
            Non c'e' ancora un amministratore per questa app. Posso crearne uno
            con la tua email del MelluCode account.
          </p>
          <button onClick={handleReset} disabled={resetting} className="btn-primary">
            {resetting
              ? <><Loader2 className="w-4 h-4 animate-spin" /> Creo l'admin…</>
              : <><KeyRound className="w-4 h-4" /> Crea admin e genera password</>}
          </button>
        </>
      )}
    </div>
  );
}
