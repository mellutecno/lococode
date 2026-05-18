// Logo MelluCode + topic: "Palestra" come tag a fianco.
// Niente file SVG esterni — disegnato inline cosi' scala e cambia colore col tema.
export default function Logo({ size = 28, withWordmark = true, className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size} height={size} viewBox="0 0 32 32" fill="none"
        className="drop-shadow-[0_0_16px_rgba(124,58,255,0.55)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mcg" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%"   stopColor="#a888ff" />
            <stop offset="55%"  stopColor="#7c3aff" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#mcg)" />
        <path
          d="M9 22 V10 l4.5 7 4.5 -7 V22"
          stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          fill="none"
        />
        <circle cx="22.5" cy="20.5" r="2.2" fill="white" />
      </svg>
      {withWordmark && (
        <div className="leading-none">
          <div className="text-sm font-semibold tracking-tightish text-white">MelluCode</div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500 mt-0.5">Palestra</div>
        </div>
      )}
    </div>
  );
}
