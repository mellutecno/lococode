import { APP_NAME, APP_SUBTITLE } from "../lib/api.js";

// Logo brand: gradient quadrato + wordmark dal nome app + subtitle topic.
// Niente file SVG esterni, scala con la palette del tema (gradient definito
// con i colori dell'accento via vars CSS qui sotto).
export default function Logo({ size = 28, withWordmark = true, className = "" }) {
  return (
    <div className={`inline-flex items-center gap-2.5 ${className}`}>
      <svg
        width={size} height={size} viewBox="0 0 32 32" fill="none"
        className="drop-shadow-[0_0_16px_var(--brand-glow,rgba(124,58,255,0.55))]"
        style={{ ["--brand-glow"]: "__THEME_ACCENT_500__99" }}
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="appgrad" x1="0" y1="0" x2="32" y2="32">
            <stop offset="0%"   stopColor="__THEME_ACCENT_300__" />
            <stop offset="100%" stopColor="__THEME_ACCENT_600__" />
          </linearGradient>
        </defs>
        <rect x="0" y="0" width="32" height="32" rx="9" fill="url(#appgrad)" />
        <text
          x="16" y="22" textAnchor="middle"
          fontSize="16" fontWeight="700"
          fill="white" fontFamily="Inter, sans-serif"
        >
          {(APP_NAME?.[0] || "·").toUpperCase()}
        </text>
      </svg>
      {withWordmark && (
        <div className="leading-none">
          <div className="text-sm font-semibold tracking-tightish text-ink-100">{APP_NAME}</div>
          {APP_SUBTITLE && (
            <div className="text-[10px] uppercase tracking-[0.16em] text-ink-400 mt-0.5">{APP_SUBTITLE}</div>
          )}
        </div>
      )}
    </div>
  );
}
