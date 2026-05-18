import { useEffect, useState } from "react";
import { mc } from "../lib/api.js";

// Le route /v1/files/:id/content richiedono bearer header, quindi non si
// possono usare direttamente come <img src>. Scarichiamo il blob via SDK
// (che inietta l'Authorization) e creiamo un object URL temporaneo.
//
// Cleanup: l'object URL viene revocato quando il componente smonta o l'id
// cambia, per non leakare memoria.
export default function ImageFromFileId({ fileId, alt = "", className = "", fallback = null }) {
  const [url, setUrl] = useState(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let revoked = false;
    let objectUrl = null;
    setError(false);
    setUrl(null);

    if (!fileId) return;

    mc.files.downloadBlob(fileId)
      .then((blob) => {
        if (revoked) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => { if (!revoked) setError(true); });

    return () => {
      revoked = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fileId]);

  if (!fileId || error) {
    return fallback ?? (
      <div className={`flex items-center justify-center bg-slate-100 text-slate-400 text-xs ${className}`}>
        no photo
      </div>
    );
  }
  if (!url) {
    return <div className={`bg-slate-100 animate-pulse ${className}`} />;
  }
  return <img src={url} alt={alt} className={className} />;
}
