export default {
  id: "ristorante",
  label: "Ristorante / Pizzeria / Bar",
  description: "Gestione menu, prenotazioni tavoli, ordini, fornitori per attivita' di ristorazione.",
  // Rimossi "bar", "prenotazione", "tavoli", "ordini" da soli (troppo
  // ambigui — anche studi/palestre/negozi prenotano e gestiscono ordini).
  keywords: [
    "ristorante", "pizzeria", "trattoria", "osteria",
    "menu", "piatti", "pizza", "antipasto", "primo piatto", "secondo piatto",
    "food", "cucina", "chef", "delivery food",
  ],
  theme: "warm-amber",
  entities: [
    {
      name: "menu_items",
      label: "Piatti del menu",
      schema: {
        type: "object",
        properties: {
          name:         { type: "string", minLength: 1, maxLength: 120 },
          category:     { type: "string", enum: ["antipasto", "primo", "secondo", "pizza", "dolce", "bevanda", "contorno", "altro"] },
          description:  { type: "string", maxLength: 500 },
          price_cents:  { type: "integer", minimum: 0, maximum: 100000 },
          available:    { type: "boolean" },
          allergens:    { type: "array", items: { type: "string" }, maxItems: 12 },
          photo_file_id:{ type: "string" },
        },
        required: ["name", "category", "price_cents"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "UtensilsCrossed", primary: true },
    },
    {
      name: "tables",
      label: "Tavoli",
      schema: {
        type: "object",
        properties: {
          number:   { type: "integer", minimum: 1, maximum: 999 },
          seats:    { type: "integer", minimum: 1, maximum: 30 },
          location: { type: "string", enum: ["sala", "veranda", "dehors", "privato"] },
          notes:    { type: "string", maxLength: 300 },
        },
        required: ["number", "seats"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Square" },
    },
    {
      name: "reservations",
      label: "Prenotazioni",
      schema: {
        type: "object",
        properties: {
          customer_name:   { type: "string", minLength: 1, maxLength: 120 },
          customer_phone:  { type: "string", maxLength: 40 },
          customer_email:  { type: "string", format: "email" },
          party_size:      { type: "integer", minimum: 1, maximum: 60 },
          starts_at:       { type: "string", format: "date-time" },
          table_id:        { type: "string", format: "uuid" },
          status:          { type: "string", enum: ["pending", "confirmed", "seated", "completed", "no_show", "cancelled"] },
          notes:           { type: "string", maxLength: 500 },
        },
        required: ["customer_name", "party_size", "starts_at"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "admin", delete: "admin" },
      metadata: { icon: "CalendarCheck", primary: true },
    },
    {
      name: "orders",
      label: "Ordini",
      schema: {
        type: "object",
        properties: {
          table_id:       { type: "string", format: "uuid" },
          items:          {
            type: "array",
            items: {
              type: "object",
              properties: {
                menu_item_id: { type: "string", format: "uuid" },
                qty:          { type: "integer", minimum: 1, maximum: 99 },
                notes:        { type: "string", maxLength: 200 },
              },
              required: ["menu_item_id", "qty"],
            },
            minItems: 1,
          },
          status:         { type: "string", enum: ["open", "in_kitchen", "ready", "served", "paid", "cancelled"] },
          total_cents:    { type: "integer", minimum: 0 },
        },
        required: ["items"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "admin", delete: "admin" },
      metadata: { icon: "Receipt" },
    },
  ],
};
