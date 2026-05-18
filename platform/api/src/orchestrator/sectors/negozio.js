export default {
  id: "negozio",
  label: "Negozio / E-commerce",
  description: "Catalogo prodotti, categorie, ordini e clienti per negozi fisici o online.",
  // Rimossi "prodotti", "articoli", "clienti", "ordini", "vendita" da soli:
  // sono parole usate in QUALSIASI gestionale e generavano falsi positivi.
  keywords: [
    "ecommerce", "e-commerce", "shop online", "negozio online",
    "catalogo prodotti", "carrello", "checkout",
    "magazzino", "scorte", "sku",
    "boutique", "abbigliamento", "vendita online",
  ],
  theme: "light-modern",
  entities: [
    {
      name: "products",
      label: "Prodotti",
      schema: {
        type: "object",
        properties: {
          name:         { type: "string", minLength: 1, maxLength: 160 },
          sku:          { type: "string", maxLength: 60, pattern: "^[A-Za-z0-9_-]+$" },
          category_id:  { type: "string", format: "uuid" },
          description:  { type: "string", maxLength: 2000 },
          price_cents:  { type: "integer", minimum: 0 },
          stock:        { type: "integer", minimum: 0 },
          active:       { type: "boolean" },
          photo_file_id:{ type: "string" },
          tags:         { type: "array", items: { type: "string", maxLength: 40 }, maxItems: 20 },
        },
        required: ["name", "price_cents"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Package", primary: true },
    },
    {
      name: "categories",
      label: "Categorie",
      schema: {
        type: "object",
        properties: {
          name:        { type: "string", minLength: 1, maxLength: 120 },
          slug:        { type: "string", pattern: "^[a-z0-9-]+$", minLength: 1, maxLength: 80 },
          description: { type: "string", maxLength: 500 },
          parent_id:   { type: "string", format: "uuid" },
        },
        required: ["name"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "FolderTree" },
    },
    {
      name: "customers",
      label: "Clienti",
      schema: {
        type: "object",
        properties: {
          name:    { type: "string", minLength: 1, maxLength: 160 },
          email:   { type: "string", format: "email" },
          phone:   { type: "string", maxLength: 40 },
          address: { type: "string", maxLength: 300 },
          city:    { type: "string", maxLength: 80 },
          notes:   { type: "string", maxLength: 1000 },
        },
        required: ["name"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "Users" },
    },
    {
      name: "orders",
      label: "Ordini",
      schema: {
        type: "object",
        properties: {
          customer_id: { type: "string", format: "uuid" },
          items: {
            type: "array",
            items: {
              type: "object",
              properties: {
                product_id: { type: "string", format: "uuid" },
                qty:        { type: "integer", minimum: 1, maximum: 999 },
                price_cents:{ type: "integer", minimum: 0 },
              },
              required: ["product_id", "qty", "price_cents"],
            },
            minItems: 1,
          },
          total_cents: { type: "integer", minimum: 0 },
          status: { type: "string", enum: ["new", "paid", "shipped", "delivered", "refunded", "cancelled"] },
          shipping_address: { type: "string", maxLength: 400 },
          notes: { type: "string", maxLength: 500 },
        },
        required: ["customer_id", "items"],
      },
      permissions: { read: "authenticated", create: "admin", update: "admin", delete: "admin" },
      metadata: { icon: "ShoppingBag", primary: true },
    },
  ],
};
