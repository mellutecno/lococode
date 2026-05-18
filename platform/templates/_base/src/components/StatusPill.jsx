// Pill di stato con dot luminoso. Tono mappato sull'attualita' dell'abbonamento.
const MAP = {
  emerald: { cls: "pill-success", dotCls: "bg-emerald-400 text-emerald-400" },
  amber:   { cls: "pill-warn",    dotCls: "bg-amber-400 text-amber-400" },
  rose:    { cls: "pill-danger",  dotCls: "bg-rose-400 text-rose-400" },
  neutral: { cls: "pill-neutral", dotCls: "bg-zinc-400 text-zinc-400" },
};

export default function StatusPill({ tone = "neutral", children }) {
  const m = MAP[tone] || MAP.neutral;
  return (
    <span className={m.cls}>
      <span className={`pill-dot ${m.dotCls}`} />
      {children}
    </span>
  );
}
