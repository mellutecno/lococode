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

  const hasHistory = items && items.length > 0;

  return (
    <div className="card">
      {/* HEADER */}
      <div className="px-5 py-4 border-b border-white/[0.06] flex items-center gap-2.5">
        <div className="grid place-items-center w-8 h-8 rounded-lg bg-gradient-to-br from-accent-400 to-violet-500 shadow-glow-sm flex-shrink-0">
          <Sparkles className="w-4 h-4 text-white" />
        </div>
        <div className="min-w-0">
          <h3 className="text-base font-semibold text-white">Modifica l'app con un messaggio</h3>
          <p className="text-xs text-zinc-400">Scrivi cosa vuoi cambiare e premi Invia. L'app si aggiorna da sola.</p>
        </div>
      </div>

      {/* INPUT IN ALTO, GROSSO, CHIARO */}
      <form onSubmit={handleSubmit} className="p-5 border-b border-white/[0.06]">
        <label htmlFor="revision-input" className="label">
          Cosa vuoi cambiare?
        </label>
        <div className="relative">
          <textarea
            id="revision-input"
            ref={textareaRef}
            className="textarea min-h-[88px] pr-14 text-[15px] leading-relaxed"
            rows={3}
            placeholder={disabled
              ? "Aspetta che l'app finisca di aggiornarsi…"
              : "Es. aggiungi un campo telefono ai clienti, oppure cambia il tema in caldo"}
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={handleKey}
            disabled={disabled || sending}
            maxLength={2000}
          />
          <button
            type="submit"
            disabled={!text.trim() || sending || disabled}
            className="btn-primary !h-10 !w-10 !p-0 absolute right-2 bottom-2 flex-shrink-0"
            title="Invia (Enter)"
            aria-label="Invia"
          >
            {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        {empty && !loading && (
          <div className="mt-3 flex flex-wrap gap-2">
            {[
              "Aggiungi un campo telefono ai clienti",
              "Cambia tema in caldo",
              "Aggiungi una tabella per le note interne",
            ].map((sug) => (
              <button
                key={sug}
                type="button"
                onClick={() => { setText(sug); textareaRef.current?.focus(); }}
                disabled={disabled || sending}
                className="text-xs px-2.5 py-1 rounded-full bg-white/[0.04] border border-white/[0.06] text-zinc-300 hover:bg-white/[0.08] hover:border-accent-500/30 hover:text-white transition disabled:opacity-50"
              >
                {sug}
              </button>
            ))}
          </div>
        )}
        <p className="help mt-2">Premi <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px]">Invio</kbd> per inviare, <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-[10px]">Shift+Invio</kbd> per andare a capo.</p>
      </form>

      {/* STORIA SOTTO L'INPUT, OPZIONALE */}
      {(loading || hasHistory || sending) && (
        <div ref={scrollRef} className="px-5 py-4 max-h-[24rem] overflow-y-auto space-y-4">
          {loading && (
            <div className="flex items-center gap-2 text-xs text-zinc-500 justify-center py-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin text-accent-400" />
              Carico storico…
            </div>
          )}
          {hasHistory && (
            <p className="text-[10px] uppercase tracking-wider text-zinc-500 font-medium">Cronologia modifiche</p>
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
      )}
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
