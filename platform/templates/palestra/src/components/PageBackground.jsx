// Sfondo aurora animato globale. Sta sotto a tutto, pointer-events: none.
// Usa due gradient radiali che pulsano molto piano — sensazione "alive"
// senza rubare attenzione al contenuto.
export default function PageBackground() {
  return (
    <div aria-hidden className="fixed inset-0 -z-10 overflow-hidden pointer-events-none">
      <div className="absolute -top-32 -left-32 w-[60vw] h-[60vw] bg-aurora-1 animate-aurora" />
      <div className="absolute top-1/3 -right-32 w-[55vw] h-[55vw] bg-aurora-2 animate-aurora [animation-delay:-7s]" />
      <div className="absolute inset-0 bg-grid opacity-[0.35]" />
      <div className="absolute inset-0 bg-gradient-to-b from-ink-950/0 via-ink-950/40 to-ink-950" />
    </div>
  );
}
