import { AppWindow, Sparkles } from "lucide-react";

const sizes = {
  sm: {
    box: "w-11 h-11 rounded-xl",
    icon: "w-5 h-5",
    spark: "w-3 h-3",
  },
  lg: {
    box: "w-20 h-20 rounded-2xl",
    icon: "w-9 h-9",
    spark: "w-4 h-4",
  },
};

export default function AppIcon({ size = "sm", className = "" }) {
  const s = sizes[size] || sizes.sm;

  return (
    <div
      className={`${s.box} relative grid place-items-center bg-gradient-to-br from-accent-300 via-accent-500 to-violet-500 shadow-glow ring-2 ring-accent-500/40 ring-offset-2 ring-offset-ink-900 overflow-hidden ${className}`}
      aria-hidden
    >
      <div className="absolute inset-0 bg-grid opacity-30" />
      <AppWindow className={`${s.icon} relative text-white drop-shadow`} strokeWidth={2.2} />
      <Sparkles className={`${s.spark} absolute right-2 top-2 text-white/80`} strokeWidth={2.4} />
    </div>
  );
}
