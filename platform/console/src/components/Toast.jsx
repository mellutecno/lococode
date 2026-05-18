import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, Info, X } from "lucide-react";

const ToastCtx = createContext(null);

const VARIANTS = {
  success: { Icon: CheckCircle2, cls: "border-emerald-400/30 bg-emerald-500/10 text-emerald-100",
             iconCls: "text-emerald-300" },
  error:   { Icon: AlertTriangle, cls: "border-rose-400/30 bg-rose-500/10 text-rose-100",
             iconCls: "text-rose-300" },
  info:    { Icon: Info, cls: "border-accent-400/30 bg-accent-500/10 text-accent-100",
             iconCls: "text-accent-300" },
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);

  const push = useCallback((message, variant = "info") => {
    const id = Math.random().toString(36).slice(2);
    setItems((xs) => [...xs, { id, message, variant }]);
    setTimeout(() => setItems((xs) => xs.filter((t) => t.id !== id)), 4200);
  }, []);

  const api = {
    success: (m) => push(m, "success"),
    error:   (m) => push(m, "error"),
    info:    (m) => push(m, "info"),
  };

  return (
    <ToastCtx.Provider value={api}>
      {children}
      <div className="fixed z-50 bottom-4 right-4 flex flex-col gap-2 max-w-sm">
        {items.map((t) => {
          const v = VARIANTS[t.variant] || VARIANTS.info;
          return (
            <div key={t.id} role="status"
              className={`animate-rise flex items-start gap-3 px-4 py-3 rounded-xl border backdrop-blur-xl shadow-card ${v.cls}`}>
              <v.Icon className={`w-4 h-4 mt-0.5 ${v.iconCls}`} />
              <div className="text-sm leading-snug">{t.message}</div>
              <button
                onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))}
                className="text-zinc-400 hover:text-white ml-2"
                aria-label="Chiudi"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  if (!ctx) throw new Error("useToast deve stare dentro ToastProvider");
  return ctx;
}
