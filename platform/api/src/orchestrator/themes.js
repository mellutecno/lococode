// Catalogo dei temi visivi disponibili per le app generate.
// Ogni tema e' SOLO un identificatore + descrizione di vibe — i valori reali
// (palette, font, radius) vivono lato template/builder nello Step 3a, dove
// faranno la sostituzione dei token Tailwind.
//
// Qui ci serve:
// - una lista chiusa: il prompt-system passa SOLO da qui per evitare che l'AI
//   inventi temi inesistenti
// - una descrizione vibe leggibile, da iniettare nei few-shot per guidare la
//   scelta dell'AI ("ristorante? warm-amber, vibe accogliente")

export const THEMES = Object.freeze({
  "dark-electric": {
    id: "dark-electric",
    label: "Dark Electric",
    base: "dark",
    accent: "violet/cyan",
    vibe: "energia, sport, movimento, notturno, vibrante",
    examples: "Linear, Cursor, Vercel",
  },
  "warm-amber": {
    id: "warm-amber",
    label: "Warm Amber",
    base: "dark warm",
    accent: "amber/terracotta",
    vibe: "accogliente, conviviale, ristorazione, caldo, italiano",
    examples: "menu di trattorie premium, food editorial",
  },
  "light-modern": {
    id: "light-modern",
    label: "Light Modern",
    base: "light",
    accent: "indigo/violet",
    vibe: "pulito, ordinato, e-commerce, prodotto, neutro",
    examples: "Stripe, Notion, Shopify admin",
  },
  "navy-trust": {
    id: "navy-trust",
    label: "Navy Trust",
    base: "light navy",
    accent: "navy/gold",
    vibe: "professionale, autorevole, fiducia, studio legale, finance, medico",
    examples: "studi legali premium, banche private, dentisti",
  },
  "editorial-rose": {
    id: "editorial-rose",
    label: "Editorial Rose",
    base: "cream",
    accent: "rose/fuchsia",
    vibe: "elegante, romantico, editorial, beauty, eventi, wedding",
    examples: "magazine di moda, wedding planner, beauty brand",
  },
  "dark-cyan": {
    id: "dark-cyan",
    label: "Dark Cyan",
    base: "dark",
    accent: "cyan/violet",
    vibe: "tech, dev tool, portfolio creativo, agenzia digital",
    examples: "Vercel docs, portfolio designer, agency dark",
  },
  "sage-wellness": {
    id: "sage-wellness",
    label: "Sage Wellness",
    base: "off-white",
    accent: "sage/eucalyptus",
    vibe: "wellness, yoga, naturale, calma, holistic",
    examples: "studi yoga, brand di tisane, wellness app",
  },
});

export const THEME_IDS = Object.keys(THEMES);

export function isValidThemeId(id) {
  return Object.prototype.hasOwnProperty.call(THEMES, id);
}

// Compatta tutte le scelte tema in una lista leggibile per il prompt orchestrator.
// Output: "- dark-electric: energia, sport, movimento (Linear/Cursor)\n- ..."
export function themesPromptList() {
  return Object.values(THEMES)
    .map((t) => `- ${t.id}: ${t.vibe} (esempi: ${t.examples})`)
    .join("\n");
}
