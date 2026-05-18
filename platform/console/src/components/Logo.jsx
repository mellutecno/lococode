// Logo MelluCode versione console (wordmark grande, niente topic-tag).
export default function Logo({ size = 30, withWordmark = true, className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size} height={size} viewBox="0 0 32 32" fill="none"
        className="drop-shadow-[0_0_18px_rgba(34,211,238,0.55)]"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="mcg-console" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%"   stopColor="#a5f3fc" />
            <stop offset="55%"  stopColor="#22d3ee" />
            <stop offset="100%" stopColor="#7c3aff" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#mcg-console)" />
        <path
          d="M9 22 V10 l4.5 7 4.5 -7 V22"
          stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
          fill="none"
        />
        <circle cx="22.5" cy="20.5" r="2.2" fill="white" />
      </svg>
      {withWordmark && (
        <span className="text-base font-semibold tracking-tightish text-white">
          MelluCode
        </span>
      )}
    </div>
  );
}
