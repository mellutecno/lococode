# mellucode-api

Backend gestito di MelluCode (Fastify + Postgres + Drizzle).

## Setup locale

```bash
cd platform/api
npm install
cp .env.example .env
# edita .env con credenziali postgres + JWT_SECRET random
npm run db:generate    # genera migrations da schema.js
npm run dev            # avvia con --watch
```

Test rapido:

```bash
# health
curl http://127.0.0.1:5000/v1/health

# register
curl -X POST http://127.0.0.1:5000/v1/auth/register \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123","name":"Test"}'

# login
curl -X POST http://127.0.0.1:5000/v1/auth/login \
  -H 'Content-Type: application/json' \
  -d '{"email":"test@example.com","password":"password123"}'

# /me (sostituisci TOKEN)
curl http://127.0.0.1:5000/v1/auth/me -H 'Authorization: Bearer TOKEN'
```

## Struttura

```
src/
  server.js           — entrypoint Fastify
  config.js           — env loader
  db/
    index.js          — drizzle client
    schema.js         — definizione tabelle
    migrate.js        — applicatore migrations runtime
    migrations/       — SQL generato da drizzle-kit
  plugins/
    auth.js           — @fastify/jwt + decorator authenticate
  routes/
    auth.js           — /v1/auth/{register,login,refresh,logout,me}
  utils/
    hash.js           — argon2 + token helpers
```
