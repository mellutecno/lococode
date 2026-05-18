import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { mc, MEMBERS_ENTITY, subscriptionStatus } from "../lib/api.js";
import ImageFromFileId from "../components/ImageFromFileId.jsx";

const TONE_CLASS = {
  emerald: "bg-emerald-50 text-emerald-700 border-emerald-200",
  amber:   "bg-amber-50 text-amber-700 border-amber-200",
  rose:    "bg-rose-50 text-rose-700 border-rose-200",
};

export default function MembersListPage() {
  const [records, setRecords] = useState(null);
  const [error, setError] = useState(null);

  async function load() {
    try {
      const res = await mc.data(MEMBERS_ENTITY).list({ limit: 100 });
      setRecords(res.records || []);
    } catch (err) {
      setError(err.message);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <div>
          <h1 className="text-2xl font-bold">Membri</h1>
          <p className="text-sm text-slate-500">{records?.length ?? "—"} totali</p>
        </div>
        <Link to="/new" className="btn-primary">+ Nuovo membro</Link>
      </div>

      {error && <p className="text-sm text-rose-600 mb-3">{error}</p>}
      {records === null && !error && <p className="text-slate-500">Caricamento…</p>}
      {records?.length === 0 && (
        <div className="card p-10 text-center text-slate-500">
          Nessun membro ancora. <Link to="/new" className="text-brand-600 font-medium">Aggiungi il primo →</Link>
        </div>
      )}

      <ul className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {records?.map((r) => {
          const m = r.data || {};
          const s = subscriptionStatus(m.subscription_until);
          return (
            <li key={r.id} className="card p-4 flex gap-3">
              <ImageFromFileId fileId={m.photo_file_id} alt={m.name}
                               className="w-20 h-20 rounded-md object-cover bg-slate-100 flex-shrink-0" />
              <div className="flex-1 min-w-0">
                <Link to={`/m/${r.id}`} className="font-semibold text-slate-900 hover:text-brand-600 block truncate">
                  {m.name || "(senza nome)"}
                </Link>
                <p className="text-xs text-slate-500 truncate">{m.email || "—"}</p>
                <span className={`inline-block mt-2 text-xs px-2 py-0.5 rounded border ${TONE_CLASS[s.tone]}`}>
                  {s.label}
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
