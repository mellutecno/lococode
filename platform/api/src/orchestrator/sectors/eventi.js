export default {
  id: "eventi",
  label: "Eventi / Wedding planner / Location",
  description: "Organizzazione eventi, matrimoni, gestione fornitori, prenotazioni location.",
  // Rimossi "evento", "festa", "musica", "sala" da soli (troppo generici).
  // Tenuti i match forti settore-specifici.
  keywords: [
    "matrimonio", "matrimoni", "wedding", "wedding planner",
    "cerimonia", "ricevimento", "battesimo", "comunione", "anniversario",
    "sposi", "invitati matrimonio", "catering matrimonio", "fotografo matrimonio",
    "organizzazione eventi", "event planning",
  ],
  theme: "editorial-rose",
  entities: [
    {
      name: "events",
      label: "Eventi",
      schema: {
        type: "object",
        properties: {
          title:        { type: "string", minLength: 1, maxLength: 200 },
          type:         { type: "string", enum: ["matrimonio", "compleanno", "azienda", "battesimo", "comunione", "anniversario", "altro"] },
          date:         { type: "string", format: "date" },
          guests_count: { type: "integer", minimum: 1, maximum: 5000 },
          location:     { type: "string", maxLength: 200 },
          budget_cents: { type: "integer", minimum: 0 },
          status:       { type: "string", enum: ["draft", "planning", "confirmed", "completed", "cancelled"] },
          cover_file_id:{ type: "string" },
          notes:        { type: "string", maxLength: 2000 },
        },
        required: ["title", "date"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "owner_or_admin", delete: "admin" },
      metadata: { icon: "Sparkles", primary: true },
    },
    {
      name: "vendors",
      label: "Fornitori",
      schema: {
        type: "object",
        properties: {
          name:        { type: "string", minLength: 1, maxLength: 160 },
          category:    { type: "string", enum: ["catering", "fotografo", "musica", "fiori", "location", "wedding_planner", "auto", "abito", "altro"] },
          contact:     { type: "string", maxLength: 160 },
          email:       { type: "string", format: "email" },
          phone:       { type: "string", maxLength: 40 },
          website:     { type: "string", format: "uri" },
          rating:      { type: "integer", minimum: 1, maximum: 5 },
          notes:       { type: "string", maxLength: 1500 },
        },
        required: ["name", "category"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Briefcase" },
    },
    {
      name: "guests",
      label: "Invitati",
      schema: {
        type: "object",
        properties: {
          event_id:  { type: "string", format: "uuid" },
          name:      { type: "string", minLength: 1, maxLength: 160 },
          email:     { type: "string", format: "email" },
          phone:     { type: "string", maxLength: 40 },
          rsvp:      { type: "string", enum: ["pending", "yes", "no", "maybe"] },
          seats:     { type: "integer", minimum: 1, maximum: 20 },
          dietary:   { type: "string", maxLength: 200 },
          table_number: { type: "integer", minimum: 1, maximum: 200 },
        },
        required: ["event_id", "name"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "owner_or_admin", delete: "owner_or_admin" },
      metadata: { icon: "Users" },
    },
  ],
};
