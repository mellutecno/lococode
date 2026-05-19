import { useEffect, useState } from "react";
import { Loader2, Upload, X } from "lucide-react";
import { mc } from "../lib/api.js";
import { formatValue, toHexColor, isValidHex, COLOR_NAMED_PALETTE } from "../lib/entityIntrospect.js";

export function FieldInput({ field, value, onChange }) {
  if (field.kind === "select") {
    // Select con eventuale swatch colore se il field e' "color"-ish e i valori
    // sono noti nella palette (rosso/blu/...). Altrimenti select normale.
    const isColorEnum = /(^|_)(color|colour|colore)($|_)/i.test(field.name) &&
      (field.enum || []).every((v) => COLOR_NAMED_PALETTE[String(v).toLowerCase()] || isValidHex(v));
    if (isColorEnum) {
      return (
        <div className="flex flex-wrap gap-2">
          {(field.enum || []).map((v) => {
            const hex = toHexColor(v);
            const selected = String(value || "") === String(v);
            return (
              <button
                key={v}
                type="button"
                onClick={() => onChange(v)}
                className={`flex items-center gap-2 px-3 h-9 rounded-xl border transition ${selected ? "border-accent-400/60 shadow-glow-sm bg-white/[0.05]" : "border-white/[0.08] bg-white/[0.02] hover:border-white/15"}`}
              >
                <span className="w-4 h-4 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: hex }} />
                <span className={`text-sm ${selected ? "text-white" : "text-ink-200"}`}>{v}</span>
              </button>
            );
          })}
        </div>
      );
    }
    return (
      <select className="select" value={value ?? ""} onChange={(e) => onChange(e.target.value)} required={field.required}>
        <option value="">— scegli —</option>
        {(field.enum || []).map((v) => <option key={v} value={v}>{formatValue(field, v)}</option>)}
      </select>
    );
  }

  if (field.kind === "color") {
    return <ColorInput value={value} onChange={onChange} required={field.required} />;
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
    time: "time",
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
  if (field.kind === "color" && value) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="w-4 h-4 rounded-full ring-1 ring-white/20 shrink-0" style={{ background: toHexColor(value) }} />
        <span className="text-ink-200">{value}</span>
      </span>
    );
  }
  return <span>{formatValue(field, value)}</span>;
}

// ColorInput: palette rapida (8 colori brand-aware) + color picker nativo
// + text input per hex/nome. Accetta sia nomi italiani ("rosso") sia hex.
const QUICK_PALETTE = [
  { name: "Rosso",  hex: "#ef4444" },
  { name: "Arancio", hex: "#f59e0b" },
  { name: "Giallo", hex: "#eab308" },
  { name: "Verde",  hex: "#22c55e" },
  { name: "Ciano",  hex: "#06b6d4" },
  { name: "Blu",    hex: "#3b82f6" },
  { name: "Viola",  hex: "#8b5cf6" },
  { name: "Fucsia", hex: "#ec4899" },
];

function ColorInput({ value, onChange, required }) {
  const hex = toHexColor(value);
  const isHex = isValidHex(String(value || ""));
  const knownName = !isHex && String(value || "").trim();
  return (
    <div className="space-y-3">
      {/* Palette rapida */}
      <div className="grid grid-cols-8 gap-2">
        {QUICK_PALETTE.map((c) => {
          const selected = (isHex && hex.toLowerCase() === c.hex.toLowerCase()) ||
                          (knownName && knownName.toLowerCase() === c.name.toLowerCase());
          return (
            <button
              key={c.hex}
              type="button"
              title={c.name}
              onClick={() => onChange(c.hex)}
              className={`relative w-9 h-9 rounded-full ring-1 transition ${selected ? "ring-2 ring-white shadow-glow-sm scale-110" : "ring-white/20 hover:scale-105"}`}
              style={{ background: c.hex }}
              aria-label={`Seleziona ${c.name}`}
            />
          );
        })}
      </div>

      {/* Color picker nativo + text */}
      <div className="flex items-center gap-3">
        <label className="relative w-12 h-12 rounded-xl border border-white/[0.08] overflow-hidden cursor-pointer hover:border-accent-500/40 transition shrink-0" title="Color picker">
          <input
            type="color"
            value={hex}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          />
          <span className="block w-full h-full" style={{ background: hex }} />
        </label>
        <input
          type="text"
          className="input"
          value={value ?? ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder="#7c3aff oppure rosso"
          required={required}
        />
      </div>

      {/* Help */}
      <p className="text-xs text-ink-500">
        Scegli un colore dalla palette, dal picker, o scrivi un hex (es. <span className="font-mono text-ink-300">#7c3aff</span>) o un nome italiano.
      </p>
    </div>
  );
}
