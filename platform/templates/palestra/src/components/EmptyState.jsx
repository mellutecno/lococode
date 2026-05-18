// Stato vuoto premium: illustrazione SVG inline (dumbell), microcopy chiara,
// CTA primaria. Mai testo nudo.
import { Link } from "react-router-dom";

export default function EmptyState({
  title = "Niente da mostrare",
  description,
  cta,
  to,
  icon = "dumbbell",
}) {
  return (
    <div className="card animate-rise px-6 py-14 text-center max-w-lg mx-auto">
      <div className="mx-auto mb-5 relative w-20 h-20">
        <div className="absolute inset-0 rounded-full bg-aurora-1 blur-2xl opacity-70" />
        <div className="relative grid place-items-center w-full h-full rounded-2xl bg-gradient-to-br from-accent-500/15 to-cyan-500/10 border border-accent-500/20">
          {icon === "dumbbell" ? (
            <DumbbellIcon />
          ) : (
            <SparkleIcon />
          )}
        </div>
      </div>
      <h3 className="text-xl font-semibold text-white">{title}</h3>
      {description && (
        <p className="mt-2 text-sm text-zinc-400 max-w-sm mx-auto leading-relaxed">
          {description}
        </p>
      )}
      {cta && to && (
        <Link to={to} className="btn-primary mt-6">
          {cta}
        </Link>
      )}
    </div>
  );
}

function DumbbellIcon() {
  return (
    <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         className="text-accent-300">
      <path d="M6 6v12M3 9v6M18 6v12M21 9v6M6 12h12" />
    </svg>
  );
}
function SparkleIcon() {
  return (
    <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"
         className="text-accent-300">
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M5 5l3 3M16 16l3 3M19 5l-3 3M8 16l-3 3" />
    </svg>
  );
}
