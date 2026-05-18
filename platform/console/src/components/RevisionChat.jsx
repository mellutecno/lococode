import { useEffect, useRef, useState } from "react";
import { Loader2, Send, Sparkles, CheckCircle2, AlertCircle, User } from "lucide-react";
import { tenants } from "../lib/api.js";
import { useToast } from "./Toast.jsx";

// Chat persistente con AI per chiedere modifiche all'app in italiano.
// Pattern: user message -> AI summary (riga di sistema) -> opzionale link
// al build scatenato. Storia caricata da listRevisions ad ogni mount o
// refresh. Manda con Enter (Shift+Enter = nuova riga).
//
// Props:
// - tenantId: string (uuid)
// - disabled: bool (es. durante un build in corso, blocca il submit)
// - onRevisionSent({revision, buildId}): callback per far ripartire polling
//   nel parent (AppDetailPage gia' gestisce il polling build via listBuilds).
export default function RevisionChat({ tenantId, disabled = false, onRevisionSent }) {
  const toast = useToast();
  const [items, setItems] = useState(null); // null = loading, [] = empty, [...] = caricato
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef(null);
  const textareaRef = useRef(null);

  async function load() {
    try {
      const res = await tenants.listRevisions(tenantId, { limit: 50 });
      setItems(res?.revisions || []);
    } catch (err) {
      setItems([]);
    }
  }

  useEffect(() => { if (tenantId) load(); }, [tenantId]);

  // Auto-scroll a fondo quando arrivano messaggi.
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [items?.length, sending]);

  async function handleSubmit(e) {
    e?.preventDefault();
    const t = text.trim();
    if (!t || sending) return;
    setSending(true);
    try {
      const res = await tenants.sendRevision(tenantId, t);
      // Push subito il nuovo item in lista (response include la revision)
      setItems((prev) => [...(prev || []), res.revision]);
      setText("");
      if (res.buildId && onRevisionSent) onRevisionSent({ revision: res.revision, buildId: res.buildId });
      if (res.applied?.length) {
        toast.success(`Modifica accettata. Genero l'aggiornamento.`);
      } else {
        toast.info("Richiesta registrata, nessuna modifica applicata.");
      }
    } catch (err) {
      // Errori "umani": mostriamo nel chat come messaggio di sistema fallito
      const fakeRevision = {
        id: `local-${Date.now()}`,
        requestText: t,
        status: "failed",
        errorMessage: err?.message || "Non sono riuscito a interpretare.",
        interpretation: {},
        createdAt: new Date().toISOString(),
      };
      setItems((prev) => [...(prev || []), fakeRevision]);
      toast.error(err?.message || "Errore richiesta.");
    } finally {
      setSending(false);
      textareaRef.current?.focus();
    }
  }

  function handleKey(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  const empty = items?.length === 0;
  const loading = items === null;

  return (
    <div className="card flex flex-col h-[28rem]">
      <div className="px-5 py-3 border-b border-white/[0.06] flex items-center justify-between gap-3">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="grid place-items-center w-7 h-7 rounded-lg bg-gradient-to-br from-accent-400 to-violet-500 shadow-glow-sm flex-shrink-0">
            <Sparkles className="w-3.5 h-3.5 text-white" />
          </div>
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-white truncate">Chiedi una modifica</h3>
            <p className="text-[11px] text-zinc-500 truncate">Scrivi in italiano cosa cambiare.</p>
          </div>
        </div>
      </div>

      {/* Stream messaggi */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
        {loading && (
          <div className="flex items-center gap-2 text-xs text-zinc-500 justify-center py-8">
            <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-400" />
            Carico storico…
          </div>
        )}
        {empty && (
          <div className="text-center py-8 max-w-sm mx-auto">
            <p className="text-sm text-zinc-300 font-medium mb-1.5">Prova a chiedermi:</p>
            <ul className="space-y-1.5 text-xs text-zinc-500 italic">
              <li>"Aggiungi un campo telefono ai clienti"</li>
              <li>"Cambia tema in caldo"</li>
              <li>"Aggiungi una tabella per le note interne"</li>
            </ul>
          </div>
        )}
        {(items || []).map((r) => (
          <RevisionMessage key={r.id} revision={r} />
        ))}
        {sending && (
          <div className="flex items-start gap-2 animate-fade-in">
            <div className="grid place-items-center w-6 h-6 rounded-full bg-gradient-to-br from-accent-400 to-violet-500 flex-shrink-0">
              <Sparkles className="w-3 h-3 text-white" />
            </div>
            <div className="flex-1 pt-1">
              <p className="text-xs text-zinc-400 italic flex items-center gap-1.5">
                <Loader2 className="w-3 h-3 animate-spin" /> Sto pensando…
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="border-t border-white/[0.06] p-3 flex items-end gap-2">
        <textarea
          ref={textareaRef}
          className="textarea !min-h-0 flex-1 resize-none"
          rows={2}
          placeholder={disabled ? "Aspetta che la build finisca…" : "Es: aggiungi un campo email ai clienti"}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={handleKey}
          disabled={disabled || sending}
          maxLength={2000}
        />
        <button
          type="submit"
          disabled={!text.trim() || sending || disabled}
          className="btn-primary !h-10 !px-3 flex-shrink-0"
          title="Invia (Enter)"
        >
          {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
        </button>
      </form>
    </div>
  );
}

function RevisionMessage({ revision }) {
  const summary = revision.interpretation?.summary;
  const isFailed = revision.status === "failed";
  const appliedCount = revision.patchApplied?.applied?.length || 0;

  return (
    <div className="space-y-2">
      {/* Messaggio utente */}
      <div className="flex items-start gap-2 animate-fade-in">
        <div className="grid place-items-center w-6 h-6 rounded-full bg-white/[0.08] border border-white/[0.06] flex-shrink-0">
          <User className="w-3 h-3 text-zinc-400" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="rounded-xl bg-white/[0.04] border border-white/[0.06] px-3 py-2 text-sm text-zinc-100 break-words">
            {revision.requestText}
          </div>
        </div>
      </div>

      {/* Risposta AI / sistema */}
      <div className="flex items-start gap-2 animate-fade-in">
        <div className={`grid place-items-center w-6 h-6 rounded-full flex-shrink-0 ${isFailed ? "bg-rose-500/15 border border-rose-400/30" : "bg-gradient-to-br from-accent-400 to-violet-500"}`}>
          {isFailed
            ? <AlertCircle className="w-3 h-3 text-rose-300" />
            : <Sparkles className="w-3 h-3 text-white" />}
        </div>
        <div className="flex-1 min-w-0">
          <div className={`rounded-xl px-3 py-2 text-sm break-words ${isFailed ? "bg-rose-500/10 border border-rose-400/20 text-rose-100" : "bg-ink-900/60 border border-white/[0.06] text-zinc-100"}`}>
            {isFailed
              ? (revision.errorMessage || "Non sono riuscito a interpretare.")
              : (summary || "Modifica registrata.")}
            {!isFailed && appliedCount > 0 && (
              <span className="ml-2 inline-flex items-center gap-1 text-[10px] text-emerald-300">
                <CheckCircle2 className="w-2.5 h-2.5" /> {appliedCount} {appliedCount === 1 ? "modifica" : "modifiche"}
              </span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
