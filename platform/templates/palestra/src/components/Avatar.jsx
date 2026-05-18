import { useEffect, useState } from "react";
import { mc } from "../lib/api.js";

// Avatar con 3 fallback (in priorita'):
// 1. Foto reale scaricata via mc.files.downloadBlob
// 2. Iniziali del nome con gradient deterministico
// 3. Placeholder neutro
//
// Le iniziali usano un gradient seedato dal nome cosi' ogni utente ha il suo
// "colore" stabile fra refresh.
function hashSeed(str) {
  let h = 0;
  for (let i = 0; i < (str || "").length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h);
}
const GRADIENTS = [
  "from-violet-500 to-indigo-500",
  "from-fuchsia-500 to-rose-500",
  "from-cyan-500 to-blue-500",
  "from-emerald-500 to-teal-500",
  "from-amber-500 to-orange-500",
  "from-pink-500 to-violet-500",
];

function initials(name) {
  if (!name) return "·";
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() || "").join("") || "·";
}

export default function Avatar({ fileId, name = "", size = "md", className = "", ring = false }) {
  const dim = {
    xs: "w-7 h-7 text-[10px]",
    sm: "w-9 h-9 text-xs",
    md: "w-12 h-12 text-sm",
    lg: "w-20 h-20 text-xl",
    xl: "w-28 h-28 text-2xl",
  }[size] || "w-12 h-12 text-sm";

  const [url, setUrl] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoked = false;
    let obj = null;
    setUrl(null); setFailed(false);
    if (!fileId) return;
    mc.files.downloadBlob(fileId)
      .then((blob) => {
        if (revoked) return;
        obj = URL.createObjectURL(blob);
        setUrl(obj);
      })
      .catch(() => { if (!revoked) setFailed(true); });
    return () => { revoked = true; if (obj) URL.revokeObjectURL(obj); };
  }, [fileId]);

  const gradient = GRADIENTS[hashSeed(name) % GRADIENTS.length];
  const ringCls = ring ? "ring-2 ring-accent-500/40 ring-offset-2 ring-offset-ink-900" : "";

  if (fileId && url && !failed) {
    return (
      <img
        src={url} alt={name}
        className={`${dim} ${ringCls} rounded-2xl object-cover bg-ink-800 ${className}`}
      />
    );
  }
  if (fileId && !url && !failed) {
    return <div className={`${dim} ${ringCls} rounded-2xl skeleton ${className}`} />;
  }
  return (
    <div
      className={`${dim} ${ringCls} rounded-2xl bg-gradient-to-br ${gradient} grid place-items-center font-semibold text-white shadow-[inset_0_1px_0_rgba(255,255,255,0.25),inset_0_-12px_24px_-12px_rgba(0,0,0,0.4)] ${className}`}
      aria-label={name}
    >
      {initials(name)}
    </div>
  );
}
