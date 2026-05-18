export default {
  id: "portfolio",
  label: "Portfolio / Agenzia creativa / Freelance",
  description: "Showcase progetti, servizi, testimonianze, contatti per freelance e agenzie.",
  // Rimossi "progetti", "clienti", "servizi", "lavori" da soli (troppo
  // generici per qualsiasi business). Tenuti i match settore-specifici.
  keywords: [
    "portfolio", "agenzia creativa", "agency", "freelance",
    "designer", "graphic designer", "web designer", "ux designer",
    "fotografo professionale", "videomaker", "studio creativo",
    "case study", "showcase lavori", "creative agency",
  ],
  theme: "dark-cyan",
  entities: [
    {
      name: "projects",
      label: "Progetti",
      schema: {
        type: "object",
        properties: {
          title:        { type: "string", minLength: 1, maxLength: 160 },
          slug:         { type: "string", pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 80 },
          client:       { type: "string", maxLength: 160 },
          year:         { type: "integer", minimum: 1990, maximum: 2100 },
          category:     { type: "string", enum: ["branding", "web", "mobile", "video", "foto", "illustrazione", "ui_ux", "altro"] },
          description:  { type: "string", maxLength: 4000 },
          cover_file_id:{ type: "string" },
          gallery:      { type: "array", items: { type: "string" }, maxItems: 20 },
          link:         { type: "string", format: "uri" },
          featured:     { type: "boolean" },
        },
        required: ["title"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Image", primary: true },
    },
    {
      name: "services",
      label: "Servizi",
      schema: {
        type: "object",
        properties: {
          name:        { type: "string", minLength: 1, maxLength: 120 },
          description: { type: "string", maxLength: 1500 },
          price_from_cents: { type: "integer", minimum: 0 },
          icon:        { type: "string", maxLength: 40 },
          active:      { type: "boolean" },
        },
        required: ["name"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Wrench" },
    },
    {
      name: "testimonials",
      label: "Testimonianze",
      schema: {
        type: "object",
        properties: {
          author:        { type: "string", minLength: 1, maxLength: 120 },
          role:          { type: "string", maxLength: 120 },
          company:       { type: "string", maxLength: 120 },
          quote:         { type: "string", minLength: 1, maxLength: 1500 },
          rating:        { type: "integer", minimum: 1, maximum: 5 },
          photo_file_id: { type: "string" },
          published:     { type: "boolean" },
        },
        required: ["author", "quote"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Quote" },
    },
    {
      name: "leads",
      label: "Contatti / Richieste",
      schema: {
        type: "object",
        properties: {
          name:      { type: "string", minLength: 1, maxLength: 160 },
          email:     { type: "string", format: "email" },
          phone:     { type: "string", maxLength: 40 },
          subject:   { type: "string", maxLength: 200 },
          message:   { type: "string", minLength: 1, maxLength: 4000 },
          source:    { type: "string", maxLength: 80 },
          status:    { type: "string", enum: ["new", "contacted", "qualified", "won", "lost"] },
        },
        required: ["name", "email", "message"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "admin", delete: "admin" },
      metadata: { icon: "Mail" },
    },
  ],
};
