import { useEffect, useState } from "react";
import { useNavigate, useParams, Link } from "react-router-dom";
import { ArrowLeft, Camera, Loader2, X, Upload, CheckCircle2 } from "lucide-react";
import { mc, MEMBERS_ENTITY } from "../lib/api.js";
import Avatar from "../components/Avatar.jsx";
import { useToast } from "../components/Toast.jsx";

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  subscription_type: "monthly",
  subscription_until: "",
  photo_file_id: "",
  notes: "",
};

function FieldRow({ label, hint, children, span = 1 }) {
  return (
    <div className={span === 2 ? "sm:col-span-2 field" : "field"}>
      <label className="label">{label}</label>
      {children}
      {hint && <div className="help">{hint}</div>}
    </div>
  );
}

export default function MemberFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();
  const toast = useToast();

  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    if (!isEdit) return;
    (async () => {
      try {
        const res = await mc.data(MEMBERS_ENTITY).get(id);
        setData({ ...EMPTY, ...(res.record?.data || {}) });
      } catch (err) {
        setError(err.message);
      } finally {
        setLoading(false);
      }
    })();
  }, [id, isEdit]);

  function update(field, value) {
    setData((d) => ({ ...d, [field]: value }));
  }

  async function handlePhoto(file) {
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Solo file immagine.");
      return;
    }
    setUploading(true);
    try {
      const res = await mc.files.upload(file, {
        metadata: { kind: "member_photo", memberName: data.name },
      });
      update("photo_file_id", res.file.id);
      toast.success("Foto caricata.");
    } catch (err) {
      toast.error(err.message || "Upload fallito.");
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Stringa vuota -> non inviare il campo (Ajv server riconosce required/empty,
    // ma per i non-required preferiamo omettere).
    const payload = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== "" && v !== null && v !== undefined)
    );

    try {
      let res;
      if (isEdit) {
        res = await mc.data(MEMBERS_ENTITY).update(id, payload);
        toast.success("Modifiche salvate.");
        navigate(`/m/${id}`);
      } else {
        res = await mc.data(MEMBERS_ENTITY).create(payload);
        toast.success("Membro creato.");
        navigate(`/m/${res.record.id}`);
      }
    } catch (err) {
      setError(err.message);
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return (
      <div className="grid place-items-center py-32 text-zinc-500 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
          Carico…
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* breadcrumb */}
      <div className="flex items-center gap-2 text-sm">
        <Link to="/" className="text-zinc-400 hover:text-white transition flex items-center gap-1.5">
          <ArrowLeft className="w-3.5 h-3.5" /> Membri
        </Link>
      </div>

      <div>
        <p className="text-xs uppercase tracking-[0.16em] text-accent-400/80 font-medium mb-2">
          {isEdit ? "Modifica" : "Nuovo"}
        </p>
        <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tighter2 text-gradient">
          {isEdit ? "Modifica membro" : "Aggiungi membro"}
        </h1>
      </div>

      <form onSubmit={handleSubmit} className="space-y-6">
        {/* ---------- Card 1: identita' + foto ---------- */}
        <div className="card p-6 sm:p-7">
          <div className="flex items-start gap-6 mb-6">
            <div className="relative group">
              <Avatar fileId={data.photo_file_id} name={data.name || "?"} size="xl" />
              <label
                htmlFor="photo-input"
                className="absolute inset-0 grid place-items-center bg-ink-950/70 rounded-2xl opacity-0 group-hover:opacity-100 transition cursor-pointer"
                title="Cambia foto"
              >
                {uploading ? (
                  <Loader2 className="w-5 h-5 text-white animate-spin" />
                ) : (
                  <Camera className="w-5 h-5 text-white" />
                )}
              </label>
              <input
                id="photo-input" type="file" accept="image/*" className="hidden"
                onChange={(e) => handlePhoto(e.target.files?.[0])}
              />
            </div>
            <div className="flex-1 pt-2">
              <p className="text-sm text-zinc-300 font-medium">Foto profilo</p>
              <p className="text-xs text-zinc-500 mt-1 leading-relaxed">
                Passa con il mouse sull'avatar per cambiare immagine.<br />
                Max 10 MB. JPEG/PNG/WebP.
              </p>
              {data.photo_file_id && (
                <button
                  type="button"
                  onClick={() => update("photo_file_id", "")}
                  className="btn-ghost btn-sm mt-3 text-rose-300 hover:text-rose-200"
                >
                  <X className="w-3.5 h-3.5" /> Rimuovi
                </button>
              )}
              {!data.photo_file_id && (
                <label htmlFor="photo-input" className="btn-secondary btn-sm mt-3 cursor-pointer">
                  <Upload className="w-3.5 h-3.5" /> Carica
                </label>
              )}
            </div>
          </div>

          <div className="grid sm:grid-cols-2 gap-5">
            <FieldRow label="Nome *" span={2}>
              <input className="input" value={data.name}
                     onChange={(e) => update("name", e.target.value)}
                     placeholder="Mario Rossi" required />
            </FieldRow>
            <FieldRow label="Email" hint="Validata server-side (formato).">
              <input className="input" type="email" value={data.email}
                     onChange={(e) => update("email", e.target.value)}
                     placeholder="mario@example.it" />
            </FieldRow>
            <FieldRow label="Telefono">
              <input className="input" value={data.phone}
                     onChange={(e) => update("phone", e.target.value)}
                     placeholder="+39 333 1234567" />
            </FieldRow>
          </div>
        </div>

        {/* ---------- Card 2: abbonamento ---------- */}
        <div className="card p-6 sm:p-7">
          <h2 className="text-base font-semibold mb-1">Abbonamento</h2>
          <p className="text-xs text-zinc-500 mb-5">
            Il sistema calcola lo stato (attivo / in scadenza / scaduto) dalla data.
          </p>
          <div className="grid sm:grid-cols-2 gap-5">
            <FieldRow label="Tipo">
              <select className="select" value={data.subscription_type}
                      onChange={(e) => update("subscription_type", e.target.value)}>
                <option value="monthly">Mensile</option>
                <option value="quarterly">Trimestrale</option>
                <option value="yearly">Annuale</option>
                <option value="none">Nessuno</option>
              </select>
            </FieldRow>
            <FieldRow label="Scadenza">
              <input className="input" type="date" value={data.subscription_until}
                     onChange={(e) => update("subscription_until", e.target.value)} />
            </FieldRow>
          </div>
        </div>

        {/* ---------- Card 3: note ---------- */}
        <div className="card p-6 sm:p-7">
          <h2 className="text-base font-semibold mb-1">Note</h2>
          <p className="text-xs text-zinc-500 mb-5">Visibili solo allo staff.</p>
          <textarea className="textarea" value={data.notes}
                    onChange={(e) => update("notes", e.target.value)}
                    placeholder="Preferenze, intolleranze, obiettivi…" />
        </div>

        {error && (
          <div className="card p-4 border-rose-400/30 bg-rose-500/5">
            <p className="text-sm text-rose-200">{error}</p>
          </div>
        )}

        {/* ---------- Sticky action bar ---------- */}
        <div className="sticky bottom-4 z-20">
          <div className="glass rounded-2xl px-4 py-3 flex items-center justify-between gap-3 shadow-card">
            <button type="button" onClick={() => navigate(-1)} className="btn-ghost">
              Annulla
            </button>
            <button type="submit" disabled={busy} className="btn-primary">
              {busy ? (
                <><Loader2 className="w-4 h-4 animate-spin" /> Salvo…</>
              ) : (
                <><CheckCircle2 className="w-4 h-4" /> {isEdit ? "Salva modifiche" : "Crea membro"}</>
              )}
            </button>
          </div>
        </div>
      </form>
    </div>
  );
}
