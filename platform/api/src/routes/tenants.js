// Tenant/app registry. Ogni app generata da MelluCode e' un tenant.
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { hashPassword } from "../utils/hash.js";
import { normalizeEmail, slugify } from "../utils/normalize.js";

function publicTenant(t) {
  if (!t) return null;
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    plan: t.plan,
    publicRegistrationEnabled: t.publicRegistrationEnabled,
    metadata: t.metadata,
    createdAt: t.createdAt,
  };
}

function duplicateError(err) {
  return err?.code === "23505";
}

export default async function tenantRoutes(fastify) {
  fastify.get(
    "/",
    { onRequest: [fastify.authenticate] },
    async (req) => {
      const rows = await db
        .select()
        .from(schema.mcTenants)
        .where(eq(schema.mcTenants.ownerUserId, req.user.sub));
      return { tenants: rows.map(publicTenant) };
    }
  );

  fastify.post(
    "/",
    {
      onRequest: [fastify.authenticate],
      schema: {
        body: {
          type: "object",
          required: ["name"],
          properties: {
            name: { type: "string", minLength: 2, maxLength: 160 },
            slug: { type: "string", minLength: 2, maxLength: 80 },
            adminEmail: { type: "string", maxLength: 320 },
            adminPassword: { type: "string", minLength: 8, maxLength: 200 },
            adminName: { type: "string", maxLength: 120 },
            publicRegistrationEnabled: { type: "boolean" },
          },
          additionalProperties: false,
        },
      },
    },
    async (req, reply) => {
      const name = String(req.body.name || "").trim();
      const slug = slugify(req.body.slug || name);
      if (!slug) return reply.code(400).send({ error: "Slug tenant non valido." });

      const wantsInitialAdmin = Boolean(req.body.adminEmail || req.body.adminPassword);
      if (wantsInitialAdmin) {
        const adminEmail = normalizeEmail(req.body.adminEmail);
        const adminPassword = String(req.body.adminPassword || "");
        if (!adminEmail) return reply.code(400).send({ error: "Email admin non valida." });
        if (adminPassword.length < 8) return reply.code(400).send({ error: "Password admin troppo corta." });
      }

      try {
        const result = await db.transaction(async (tx) => {
          const tenantRows = await tx
            .insert(schema.mcTenants)
            .values({
              ownerUserId: req.user.sub,
              slug,
              name,
              publicRegistrationEnabled: req.body.publicRegistrationEnabled ?? true,
            })
            .returning();
          const tenant = tenantRows[0];

          let initialAdmin = null;
          if (wantsInitialAdmin) {
            const passwordHash = await hashPassword(String(req.body.adminPassword));
            const adminRows = await tx
              .insert(schema.mcAppUsers)
              .values({
                tenantId: tenant.id,
                email: normalizeEmail(req.body.adminEmail),
                passwordHash,
                name: req.body.adminName?.trim() || "Admin",
                role: "admin",
                mustChangePassword: true,
              })
              .returning();
            initialAdmin = {
              id: adminRows[0].id,
              email: adminRows[0].email,
              name: adminRows[0].name,
              role: adminRows[0].role,
              mustChangePassword: adminRows[0].mustChangePassword,
            };
          }

          return { tenant, initialAdmin };
        });

        return reply.code(201).send({
          tenant: publicTenant(result.tenant),
          initialAdmin: result.initialAdmin,
        });
      } catch (err) {
        if (duplicateError(err)) {
          return reply.code(409).send({ error: "Esiste gia' un tenant con questo slug o admin." });
        }
        throw err;
      }
    }
  );
}
