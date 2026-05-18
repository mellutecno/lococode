// Stato vuoto premium: cubo isometrico SVG (vibe "no app yet") + microcopy + CTA.
export default function EmptyState({
  title = "Niente da mostrare",
  description,
  action,
}) {
  return (
    <div className="card animate-rise px-6 py-14 text-center max-w-xl mx-auto">
      <div className="mx-auto mb-6 relative w-24 h-24">
        <div className="absolute inset-0 rounded-full bg-aurora-1 blur-2xl opacity-70" />
        <div className="relative grid place-items-center w-full h-full rounded-2xl bg-gradient-to-br from-accent-500/15 to-violet-500/10 border border-accent-500/20">
          <BoxStackIcon />
        </div>
      </div>
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-zinc-400 max-w-md mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {action && <div className="mt-6 flex justify-center">{action}</div>}
    </div>
  );
}

function BoxStackIcon() {
  // Cubo isometrico stilizzato, brand-aware.
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none"
         stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"
         className="text-accent-300">
      <path d="M3 7l9-4 9 4-9 4-9-4z" />
      <path d="M3 12l9 4 9-4" />
      <path d="M3 17l9 4 9-4" />
    </svg>
  );
}
