import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { mc, MEMBERS_ENTITY, subscriptionStatus } from "../lib/api.js";
import ImageFromFileId from "../components/ImageFromFileId.jsx";

const TONE_CLASS = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber:   "bg-amber-50 text-amber-700 border-amber-200",
  rose:    "bg-rose-50 text-rose-700 border-rose-200",
};

export default function MemberDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [record, setRecord] = useState(null);
  const [error, setError] = useState(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiOutput, setAiOutput] = useState(null);
  const [aiError, setAiError] = useState(null);

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
    if (!confirm("Eliminare questo membro?")) return;
    try {
      await mc.data(MEMBERS_ENTITY).delete(id);
      navigate("/");
    } catch (err) {
      setError(err.message);
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
          { role: "system", content: "Sei un assistente di una palestra. Scrivi messaggi brevi, motivazionali e in italiano." },
          { role: "user", content: `Scrivi un messaggio personale (max 3 frasi) per ${m.name || "il membro"}, abbonamento ${m.subscription_type || "—"} in scadenza il ${m.subscription_until || "—"}. Includi un invito a rinnovare.` },
        ],
      });
      const text = res?.message?.content || res?.choices?.[0]?.message?.content || JSON.stringify(res);
      setAiOutput(text);
    } catch (err) {
      // Se la quota AI e' a zero, il backend ritorna 402: messaggio chiaro all'utente.
      if (err.status === 402) {
        setAiError("Credito AI esaurito per questa app. Contatta l'amministratore MelluCode per ricaricare.");
      } else {
        setAiError(err.message);
      }
    } finally {
      setAiBusy(false);
    }
  }

  if (error) return <p className="text-sm text-rose-600">{error}</p>;
  if (!record) return <p className="text-slate-500">Caricamento…</p>;

  const m = record.data || {};
  const s = subscriptionStatus(m.subscription_until);

  return (
    <div className="max-w-2xl mx-auto">
      <Link to="/" className="text-sm text-brand-600 hover:underline">← Tutti i membri</Link>

      <div className="card p-6 mt-3">
        <div className="flex gap-5">
          <ImageFromFileId fileId={m.photo_file_id} alt={m.name}
                           className="w-28 h-28 rounded-md object-cover bg-slate-100 flex-shrink-0" />
          <div className="flex-1 min-w-0">
            <h1 className="text-2xl font-bold">{m.name || "(senza nome)"}</h1>
            <p className="text-sm text-slate-500">{m.email || "—"} · {m.phone || "—"}</p>
            <p className="mt-2">
              <span className={`text-xs px-2 py-0.5 rounded border ${TONE_CLASS[s.tone]}`}>{s.label}</span>
              <span className="text-xs text-slate-500 ml-2">
                {m.subscription_type || "—"} · scade {m.subscription_until || "—"}
              </span>
            </p>
          </div>
        </div>

        {m.notes && (
          <div className="mt-4 pt-4 border-t border-slate-100">
            <p className="text-xs uppercase text-slate-400 mb-1">Note</p>
            <p className="text-sm text-slate-700 whitespace-pre-wrap">{m.notes}</p>
          </div>
        )}

        <div className="mt-5 flex gap-2 flex-wrap">
          <Link to={`/m/${id}/edit`} className="btn-primary">Modifica</Link>
          <button onClick={handleAiMessage} disabled={aiBusy} className="btn-ghost">
            {aiBusy ? "Genero…" : "✨ Genera messaggio"}
          </button>
          <div className="flex-1" />
          <button onClick={handleDelete} className="btn-danger">Elimina</button>
        </div>

        {aiError && <p className="mt-4 text-sm text-rose-600">{aiError}</p>}
        {aiOutput && (
          <div className="mt-4 p-3 bg-brand-50 border border-brand-200 rounded text-sm whitespace-pre-wrap">
            {aiOutput}
          </div>
        )}
      </div>
    </div>
  );
}
