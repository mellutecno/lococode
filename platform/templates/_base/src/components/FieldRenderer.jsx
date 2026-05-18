import { useEffect, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { mc } from "../lib/api.js";
import { formatValue } from "../lib/entityIntrospect.js";

export function FieldInput({ field, value, onChange }) {
  if (field.kind === "select") {
    return (
      <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={field.required}>
        {(field.enum || []).map((v) => <option key={v} value={v}>{formatValue(field, v)}</option>)}
      </select>
    );
  }

  if (field.kind === "boolean") {
    return (
      <label className="inline-flex items-center gap-3 text-sm text-ink-200">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="rounded accent-accent-500"
        />
        Attivo
      </label>
    );
  }

  if (field.kind === "textarea" || field.kind === "json") {
    return (
      <textarea
        className="textarea"
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value)}
        required={field.required}
        maxLength={field.maxLength}
        placeholder={field.kind === "json" ? '{"chiave": "valore"}' : field.label}
      />
    );
  }

  if (field.kind === "file") {
    return <FileInput value={value} onChange={onChange} />;
  }

  const type = {
    email: "email",
    url: "url",
    date: "date",
    datetime: "datetime-local",
    number: "number",
    text: "text",
  }[field.kind] || "text";

  return (
    <input
      className="input"
      type={type}
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      required={field.required}
      min={field.minimum}
      max={field.maximum}
      minLength={field.minLength}
      maxLength={field.maxLength}
      placeholder={field.label}
    />
  );
}

function FileInput({ value, onChange }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);

  async function upload(file) {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const res = await mc.files.upload(file, { metadata: { kind: "app_file" } });
      onChange(res.file.id);
    } catch (err) {
      setError(err.message || "Upload fallito.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="flex items-center gap-3">
        <FilePreview fileId={value} />
        <div className="flex-1 min-w-0">
          {value ? (
            <p className="text-xs text-ink-300 truncate">File caricato</p>
          ) : (
            <p className="text-xs text-ink-400">Nessun file caricato</p>
          )}
          {error && <p className="text-xs text-rose-300 mt-1">{error}</p>}
          <div className="flex items-center gap-2 mt-2">
            <label className="btn-secondary btn-sm cursor-pointer">
              {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
              Carica
              <input type="file" className="hidden" onChange={(e) => upload(e.target.files?.[0])} />
            </label>
            {value && (
              <button type="button" className="btn-ghost btn-sm text-rose-300" onClick={() => onChange("")}>
                <X className="w-3.5 h-3.5" /> Rimuovi
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

export function FilePreview({ fileId, className = "" }) {
  const [url, setUrl] = useState(null);

  useEffect(() => {
    let objectUrl = null;
    let cancelled = false;
    setUrl(null);
    if (!fileId) return;

    mc.files.downloadBlob(fileId)
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => setUrl(null));

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (!fileId || !url) {
    return <div className={`w-12 h-12 rounded-xl bg-white/[0.04] border border-white/[0.06] ${className}`} />;
  }

  return <img src={url} alt="" className={`w-12 h-12 rounded-xl object-cover bg-white/[0.04] ${className}`} />;
}

export function DisplayValue({ field, value }) {
  if (field.kind === "file") return <FilePreview fileId={value} className="w-20 h-20" />;
  return <span>{formatValue(field, value)}</span>;
}
