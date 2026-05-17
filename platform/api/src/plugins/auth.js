// JWT plugin: registra @fastify/jwt e decora fastify.authenticate per le route protette.
import fp from "fastify-plugin";
import fastifyJwt from "@fastify/jwt";
import { config } from "../config.js";

export default fp(async function authPlugin(fastify) {
  await fastify.register(fastifyJwt, {
    secret: config.jwt.secret,
    sign: { expiresIn: config.jwt.accessTtl },
  });

  // Helper da usare come onRequest: [fastify.authenticate]
  fastify.decorate("authenticate", async function (req, reply) {
    try {
      await req.jwtVerify();
    } catch {
      reply.code(401).send({ error: "Non autenticato." });
    }
  });
});
