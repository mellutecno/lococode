import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { mc, MEMBERS_ENTITY } from "../lib/api.js";
import ImageFromFileId from "../components/ImageFromFileId.jsx";

const EMPTY = {
  name: "",
  email: "",
  phone: "",
  subscription_type: "monthly",
  subscription_until: "",
  photo_file_id: "",
  notes: "",
};

export default function MemberFormPage() {
  const { id } = useParams();
  const isEdit = Boolean(id);
  const navigate = useNavigate();

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
    setUploading(true);
    setError(null);
    try {
      const res = await mc.files.upload(file, {
        metadata: { kind: "member_photo", memberName: data.name },
      });
      update("photo_file_id", res.file.id);
    } catch (err) {
      setError(err.message);
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);

    // Normalizza i campi opzionali: stringa vuota -> non inviare
    // (le date Ajv le validera' con format=date).
    const payload = Object.fromEntries(
      Object.entries(data).filter(([, v]) => v !== "" && v !== null && v !== undefined)
    );

    try {
      if (isEdit) {
        await mc.data(MEMBERS_ENTITY).update(id, payload);
        navigate(`/m/${id}`);
      } else {
        const created = await mc.data(MEMBERS_ENTITY).create(payload);
        navigate(`/m/${created.record.id}`);
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <p className="text-slate-500">Caricamento…</p>;

  return (
    <div className="max-w-xl mx-auto">
      <h1 className="text-2xl font-bold mb-5">{isEdit ? "Modifica membro" : "Nuovo membro"}</h1>

      <form onSubmit={handleSubmit} className="space-y-4 card p-6">
        <div className="flex gap-4 items-start">
          <ImageFromFileId fileId={data.photo_file_id} alt=""
                           className="w-24 h-24 rounded-md object-cover bg-slate-100" />
          <div className="flex-1">
            <label className="label">Foto</label>
            <input type="file" accept="image/*"
                   onChange={(e) => handlePhoto(e.target.files?.[0])}
                   className="text-sm" />
            {uploading && <p className="text-xs text-slate-500 mt-1">Upload in corso…</p>}
            {data.photo_file_id && (
              <button type="button" onClick={() => update("photo_file_id", "")}
                      className="text-xs text-rose-600 mt-2 hover:underline">
                Rimuovi foto
              </button>
            )}
          </div>
        </div>

        <div>
          <label className="label">Nome *</label>
          <input className="input" value={data.name}
                 onChange={(e) => update("name", e.target.value)} required />
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Email</label>
            <input className="input" type="email" value={data.email}
                   onChange={(e) => update("email", e.target.value)} />
          </div>
          <div>
            <label className="label">Telefono</label>
            <input className="input" value={data.phone}
                   onChange={(e) => update("phone", e.target.value)} />
          </div>
        </div>
        <div className="grid sm:grid-cols-2 gap-4">
          <div>
            <label className="label">Tipo abbonamento</label>
            <select className="input" value={data.subscription_type}
                    onChange={(e) => update("subscription_type", e.target.value)}>
              <option value="monthly">Mensile</option>
              <option value="quarterly">Trimestrale</option>
              <option value="yearly">Annuale</option>
              <option value="none">Nessuno</option>
            </select>
          </div>
          <div>
            <label className="label">Scadenza abbonamento</label>
            <input className="input" type="date" value={data.subscription_until}
                   onChange={(e) => update("subscription_until", e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Note</label>
          <textarea className="input min-h-[80px]" value={data.notes}
                    onChange={(e) => update("notes", e.target.value)} />
        </div>

        {error && <p className="text-sm text-rose-600">{error}</p>}

        <div className="flex gap-3 justify-end pt-2">
          <button type="button" onClick={() => navigate(-1)} className="btn-ghost">Annulla</button>
          <button type="submit" disabled={busy} className="btn-primary">
            {busy ? "Salvo…" : isEdit ? "Salva modifiche" : "Crea membro"}
          </button>
        </div>
      </form>
    </div>
  );
}
