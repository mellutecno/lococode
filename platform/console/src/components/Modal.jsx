import { useEffect } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

// Modal premium con backdrop blur + scale-in. Niente dep esterne.
// Esc per chiudere. Click su backdrop chiude (configurabile).
export default function Modal({ open, onClose, title, subtitle, children, maxWidth = "lg", closeOnBackdrop = true }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose?.(); };
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [open, onClose]);

  if (!open) return null;

  const maxW = {
    sm: "max-w-sm", md: "max-w-md", lg: "max-w-lg", xl: "max-w-xl", "2xl": "max-w-2xl",
  }[maxWidth] || "max-w-lg";

  return createPortal(
    <div className="fixed inset-0 z-[100] overflow-y-auto p-3 sm:p-5 animate-fade-in">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black/60 backdrop-blur-md"
        onClick={() => closeOnBackdrop && onClose?.()}
        aria-hidden
      />
      {/* Dialog */}
      <div
        role="dialog" aria-modal="true"
        className={`relative z-10 my-3 sm:my-6 mx-auto w-full ${maxW} animate-scale-in glass rounded-2xl shadow-glow-lg overflow-visible`}
      >
        {/* Top accent bar */}
        <div className="h-px shrink-0 bg-gradient-to-r from-transparent via-accent-400 to-transparent" />
        <div className="px-5 sm:px-6 py-5 border-b border-white/[0.06] flex items-start gap-4 shrink-0">
          <div className="flex-1 min-w-0">
            {title && <h2 className="text-lg font-semibold text-white">{title}</h2>}
            {subtitle && <p className="text-sm text-zinc-400 mt-1">{subtitle}</p>}
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-white p-1 -m-1 rounded transition"
            aria-label="Chiudi"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="px-5 sm:px-6 py-5">{children}</div>
      </div>
    </div>,
    document.body
  );
}
