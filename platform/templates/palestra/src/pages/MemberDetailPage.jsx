import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, Pencil, Trash2, Sparkles, Loader2, Mail, Phone, CalendarDays, NotebookPen, Copy, Check } from "lucide-react";
import { mc, MEMBERS_ENTITY, subscriptionStatus, subscriptionTypeLabel, formatDateIt } from "../lib/api.js";
import Avatar from "../components/Avatar.jsx";
import StatusPill from "../components/StatusPill.jsx";
import { useToast } from "../components/Toast.jsx";

function InfoRow({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-3 py-3.5 border-b border-white/[0.06] last:border-0">
      <Icon className="w-4 h-4 text-zinc-500 mt-0.5 flex-shrink-0" />
      <div className="flex-1 min-w-0">
        <div className="text-xs uppercase tracking-wider text-zinc-500 mb-0.5">{label}</div>
        <div className="text-sm text-zinc-100 break-words">{value || <span className="text-zinc-600">—</span>}</div>
      </div>
    </div>
  );
}

export default function MemberDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();

  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);

  const [aiBusy, setAiBusy] = useState(false);
  const [aiOutput, setAiOutput] = useState(null);
  const [aiError, setAiError] = useState(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    try {
      const res = await mc.data(MEMBERS_ENTITY).get(id);
      setRecord(res.record);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, [id]);

  async function handleDelete() {
    if (!confirm("Eliminare definitivamente questo membro?")) return;
    try {
      await mc.data(MEMBERS_ENTITY).delete(id);
      toast.success("Membro eliminato.");
      navigate("/");
    } catch (err) {
      toast.error(err.message);
    }
  }

  async function handleAiMessage() {
    setAiBusy(true);
    setAiError(null);
    setAiOutput(null);
    const m = record.data;
    try {
      const res = await mc.ai.chat({
        messages: [
          { role: "system", content: "Sei l'assistente di una palestra italiana. Tono caldo ma professionale, mai cringe. Niente emoji. Massimo 3 frasi." },
          { role: "user", content: `Scrivi un messaggio personale per ${m.name || "un membro"}. Abbonamento ${subscriptionTypeLabel(m.subscription_type)} in scadenza il ${formatDateIt(m.subscription_until)}. Includi un invito naturale a passare in palestra o rinnovare.` },
        ],
      });
      const text = res?.message?.content || res?.choices?.[0]?.message?.content || JSON.stringify(res);
      setAiOutput(text);
    } catch (err) {
      if (err.status === 402) {
        setAiError("Credito AI esaurito per questa app. Contatta l'amministratore MelluCode per ricaricare.");
      } else {
        setAiError(err.message);
      }
    } finally {
      setAiBusy(false);
    }
  }

  async function copyToClipboard() {
    if (!aiOutput) return;
    await navigator.clipboard.writeText(aiOutput);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }

  if (error) {
    return (
      <div className="card p-6 border-rose-400/30 bg-rose-500/5 max-w-lg mx-auto">
        <p className="text-sm text-rose-200">{error}</p>
        <Link to="/" className="btn-secondary btn-sm mt-4">← Torna ai membri</Link>
      </div>
    );
  }
  if (!record) {
    return (
      <div className="grid place-items-center py-32 text-zinc-500 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
          Carico…
        </div>
      </div>
    );
  }

  const m = record.data || {};
  const s = subscriptionStatus(m.subscription_until);

  return (
    <div className="max-w-3xl mx-auto space-y-6">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-zinc-400 hover:text-white transition">
        <ArrowLeft className="w-3.5 h-3.5" /> Tutti i membri
      </Link>

      {/* ---------- HERO ---------- */}
      <div className="card relative overflow-hidden p-6 sm:p-8">
        <div className="absolute inset-0 bg-gradient-to-br from-accent-700/40 via-accent-500/20 to-cyan-500/20" />
        <div className="absolute inset-0 bg-grid opacity-25" />
        <div className="absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-ink-900/80 to-transparent" />
        <div className="relative flex flex-col sm:flex-row sm:items-center gap-5">
          <Avatar fileId={m.photo_file_id} name={m.name} size="xl" ring />
          <div className="flex-1 min-w-0">
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tighter2 text-white truncate drop-shadow">
              {m.name || "(senza nome)"}
            </h1>
            <div className="flex flex-wrap items-center gap-2 mt-2">
              <StatusPill tone={s.tone}>{s.label}</StatusPill>
              <span className="pill-neutral">{subscriptionTypeLabel(m.subscription_type)}</span>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Link to={`/m/${id}/edit`} className="btn-secondary">
              <Pencil className="w-4 h-4" /> Modifica
            </Link>
            <button onClick={handleDelete} className="btn-danger" title="Elimina">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      <div className="grid lg:grid-cols-5 gap-6">
        {/* ---------- Dati ---------- */}
        <div className="card p-6 lg:col-span-3">
          <h2 className="text-sm font-medium text-zinc-400 mb-1 uppercase tracking-wider">Dati membro</h2>
          <div className="mt-2">
            <InfoRow icon={Mail}        label="Email"       value={m.email} />
            <InfoRow icon={Phone}       label="Telefono"    value={m.phone} />
            <InfoRow icon={CalendarDays} label="Scadenza"   value={formatDateIt(m.subscription_until)} />
            <InfoRow icon={NotebookPen} label="Note"        value={m.notes} />
          </div>
        </div>

        {/* ---------- AI panel ---------- */}
        <div className="lg:col-span-2 relative group">
          <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-500/40 via-accent-500/0 to-cyan-500/30 rounded-2xl blur-md opacity-60 group-hover:opacity-100 transition" />
          <div className="relative card p-6 h-full flex flex-col">
            <div className="flex items-center gap-2.5 mb-1">
              <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-accent-500 to-cyan-500 shadow-glow-sm">
                <Sparkles className="w-4 h-4 text-white" />
              </div>
              <h2 className="text-sm font-semibold text-white">Assistente AI</h2>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed mb-4">
              Genera un messaggio personalizzato per <span className="text-zinc-200">{m.name || "questo membro"}</span>.
              Backed by OpenRouter via MelluCode AI proxy.
            </p>

            <button
              onClick={handleAiMessage}
              disabled={aiBusy}
              className="btn-primary w-full"
            >
              {aiBusy ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Genero…</>
              ) : (
                <><Sparkles className="w-4 h-4" /> Genera messaggio</>
              )}
            </button>

            {aiError && (
              <div className="mt-4 px-3 py-2 rounded-lg bg-rose-500/10 border border-rose-400/20 text-xs text-rose-200">
                {aiError}
              </div>
            )}

            {aiOutput && (
              <div className="mt-4 animate-rise">
                <div className="relative">
                  <div className="absolute -inset-0.5 bg-gradient-to-br from-accent-500/30 to-cyan-500/20 rounded-xl blur-sm" />
                  <div className="relative p-4 rounded-xl bg-ink-950/80 border border-accent-500/20">
                    <p className="text-sm text-zinc-100 leading-relaxed whitespace-pre-wrap">
                      {aiOutput}
                    </p>
                    <button
                      onClick={copyToClipboard}
                      className="btn-ghost btn-sm mt-3 -ml-2"
                    >
                      {copied ? <><Check className="w-3.5 h-3.5 text-emerald-400" /> Copiato</>
                              : <><Copy className="w-3.5 h-3.5" /> Copia</>}
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="flex-1" />
            <div className="mt-4 pt-3 border-t border-white/[0.06]">
              <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">
                Powered by <span className="text-gradient-accent">OpenRouter</span> · gpt-4o-mini
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center pt-2">
        <code className="text-[10px] font-mono text-zinc-600">id · {record.id}</code>
      </div>
    </div>
  );
}
