export default {
  id: "palestra",
  label: "Palestra / Fitness / Sport",
  description: "Gestione palestre, studi personal training, corsi fitness, club sportivi.",
  keywords: [
    "palestra", "gym", "fitness", "personal trainer", "corsi", "abbonamento",
    "allenamento", "yoga", "pilates", "crossfit", "boxe", "sport", "club sportivo",
  ],
  theme: "dark-electric",
  entities: [
    {
      name: "members",
      label: "Membri",
      schema: {
        type: "object",
        properties: {
          name:               { type: "string", minLength: 1, maxLength: 120 },
          email:              { type: "string", format: "email" },
          phone:              { type: "string", maxLength: 40 },
          subscription_type:  { type: "string", enum: ["monthly", "quarterly", "yearly", "none"] },
          subscription_until: { type: "string", format: "date" },
          photo_file_id:      { type: "string" },
          notes:              { type: "string", maxLength: 2000 },
        },
        required: ["name"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "owner_or_admin", delete: "admin" },
      metadata: { icon: "Users", primary: true },
    },
    {
      name: "classes",
      label: "Corsi / Lezioni",
      schema: {
        type: "object",
        properties: {
          title:        { type: "string", minLength: 1, maxLength: 120 },
          description:  { type: "string", maxLength: 1000 },
          trainer:      { type: "string", maxLength: 120 },
          starts_at:    { type: "string", format: "date-time" },
          duration_min: { type: "integer", minimum: 5, maximum: 480 },
          capacity:     { type: "integer", minimum: 1, maximum: 200 },
          location:     { type: "string", maxLength: 120 },
        },
        required: ["title", "starts_at"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Calendar" },
    },
    {
      name: "bookings",
      label: "Prenotazioni Corsi",
      schema: {
        type: "object",
        properties: {
          class_id:    { type: "string", format: "uuid" },
          member_id:   { type: "string", format: "uuid" },
          status:      { type: "string", enum: ["confirmed", "waitlist", "cancelled"] },
          notes:       { type: "string", maxLength: 500 },
        },
        required: ["class_id"],
      },
      permissions: { read: "authenticated", create: "authenticated", update: "owner_or_admin", delete: "owner_or_admin" },
      metadata: { icon: "Ticket" },
    },
  ],
};
