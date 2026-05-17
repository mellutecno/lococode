# MelluCode — Architettura

## Visione

MelluCode genera **app complete proprietarie dell'utente** (frontend + dati + auth) usando un **backend gestito unico** (mai generato dall'AI) e un **orchestrator** che produce solo lo schema dati e il frontend.

## Componenti

### 1. `platform/api/` — mellucode-api (backend gestito)
Servizio Fastify monolitico che fornisce a TUTTE le app generate:
- `/v1/auth/*` — registrazione, login JWT, password reset, profilo
- `/v1/data/{collection}` — CRUD generico multi-tenant
- `/v1/files/*` — upload e download di file e immagini
- `/v1/email/*` — invio email transazionali (template + provider)
- `/v1/ai/*` — proxy per OpenRouter con quota per utente e tracking costi
- `/v1/admin/*` — endpoints admin di MelluCode (gestione tenant, utenti, billing)

### 2. `platform/sdk/` — mellucode-sdk (libreria JS per il frontend)
Pacchetto installabile (anche come bundle UMD via CDN) usato dai frontend delle app generate:
```js
import { MelluCode } from 'mellucode';
const mc = new MelluCode({ apiUrl: '/mc', tenantSlug: 'pizzeria-da-mario' });
await mc.auth.register({ email, password });
const products = await mc.data('products').list({ where: { active: true } });
const url = await mc.files.upload(file);
const reply = await mc.ai.chat({ messages: [...] });
```

### 3. `platform/orchestrator/` — orchestrator AI (Fase 2)
Riceve il prompt utente, lo trasforma in:
- `schema.json` — entita' dell'app con campi e validazioni
- Frontend React + Tailwind + shadcn/ui che usa il SDK
- Personalizzazioni grafiche (colori, copy, branding)

### 4. `platform/studio/` — editor live (Fase 3)
Wrapper iframe che mostra l'app in costruzione, chat per modifiche iterative, HMR vero.

---

## Database (PostgreSQL 16, multi-tenant by column)

Schema unico per tutto, isolation via `tenant_id` su ogni tabella. Migrazione futura a schema-per-tenant possibile se servisse.

### Tabelle core (Fase 1)

```
mc_tenants              — un record per "app generata" (slug univoco, owner, plan)
mc_users                — utenti DI MELLUCODE (chi crea app, paga abbonamento)
mc_sessions             — sessioni dei creator (refresh tokens)

mc_app_users            — utenti DELLE APP GENERATE (multi-tenant: tenant_id + email)
mc_app_user_sessions    — sessioni utenti delle app generate

mc_app_entities         — schema dinamico: definizione delle entita' per tenant
mc_app_records          — record EAV: payload JSON per ogni record di ogni entita'
mc_app_files            — metadata file (path su disco, mime, owner)

mc_ai_quotas            — credito AI residuo per tenant
mc_ai_usage             — log per-call delle chiamate AI (modello, token, costo)
mc_audit_log            — log eventi auth/admin (security)
```

### Approccio EAV per `mc_app_records`

```
mc_app_records:
  id           uuid pk
  tenant_id    uuid (FK mc_tenants)
  entity       text (es. "products", "bookings")
  data         jsonb (il record vero, validato contro mc_app_entities.schema)
  created_at   timestamptz
  updated_at   timestamptz
  created_by   uuid (FK mc_app_users)
  
indexes: (tenant_id, entity), GIN su data per query
```

**Why JSONB invece di schema-per-entita'**: l'AI non puo' fare migrations DDL a runtime. Con JSONB l'AI definisce solo il `mc_app_entities.schema` (Zod-like) e il backend valida automaticamente.

**Trade-off**: query complesse sono piu' lente di pure SQL columns. Per le app utente medie (CRUD su poche entita') va benissimo. Quando un'app esplode in dimensioni si puo' migrare a schema dedicato.

---

## Auth (Fase 1)

### Per i creator (utenti di MelluCode)
- `POST /v1/auth/register` `{email, password, name}` → crea `mc_users`, ritorna JWT access + refresh
- `POST /v1/auth/login` `{email, password}` → ritorna JWT
- `POST /v1/auth/refresh` `{refreshToken}` → nuovo access
- `POST /v1/auth/logout` → invalida sessione
- `GET /v1/auth/me` → profilo corrente
- `POST /v1/auth/password-reset/request` `{email}` → invia email
- `POST /v1/auth/password-reset/confirm` `{token, newPassword}`

### Per gli end-user delle app generate
Endpoint paralleli sotto `/v1/app-auth/*`. Multi-tenant: header `X-Tenant-Slug: pizzeria-da-mario` (o nel JWT). Stesso flusso ma scoped al tenant.

### Hashing password
**argon2id** con parametri OWASP 2024: memory 19MB, iterations 2, parallelism 1.

### JWT
- Access token: 15 min, HS256 con `JWT_SECRET` server (RS256 valutabile piu avanti)
- Refresh token: 30 giorni, rotato a ogni refresh, salvato hashato in `mc_sessions`
- Claim `sub`: SEMPRE stringa (UUID), no integers (lesson learned da v1)

---

## Deploy topology

```
DNS: mellucode.mellutecno.it → 178.104.175.189 (Hetzner)

NGINX (porta 443):
  server_name mellucode.mellutecno.it
  /              → reverse proxy http://127.0.0.1:5200 (mellucode-api: Fastify)
  /v1/*          → idem (API rest)
  /studio/*      → idem (editor live, Fase 3)
  /apps/{slug}/* → reverse proxy http://127.0.0.1:5100 (mellucode-renderer: serve frontend statici)

PM2:
  mellucode-api      → /opt/mellucode/platform/api (porta 5200)
  mellucode-renderer → /opt/mellucode/renderer (porta 5100, Fase 2)

POSTGRES (locale, porta 5432 solo localhost):
  database: mellucode_dev (e mellucode_prod in futuro)
  user: mellucode

FILE STORAGE (Fase 1: locale, Fase 4: S3-compatible):
  /opt/mellucode/storage/{tenant_id}/{file_id}
```

---

## Scelte tecniche non negoziabili

1. **Backend SEMPRE gestito**: l'AI generata non scrive mai endpoint Python/Node/PHP. Mai. Se serve logica di business l'utente non puo' fare, e' una limitazione che accettiamo per ora.
2. **argon2 sempre**, mai bcrypt/passlib (lesson v1).
3. **JWT `sub` sempre stringa** (lesson v1).
4. **Multi-tenant via `tenant_id` column**, validato in OGNI query (middleware automatico).
5. **Migrations versionate** con drizzle-kit, mai DDL a mano in produzione.
6. **Test obbligatori** per ogni endpoint auth prima del deploy (vitest).
7. **JSON Schema su ogni endpoint** (Fastify lo fa nativo) — niente input non validato.

---

## Roadmap Fase 1 (3-4 sett.)

- [x] Architettura scritta (questo doc)
- [x] Scaffold `platform/api/` (package.json, src/, drizzle config, env)
- [x] Schema DB iniziale + migration 0001
- [x] Endpoint `/v1/health`
- [x] Endpoint `/v1/auth/{register,login,me,refresh,logout}` per creator
- [x] Test locale con syntax check + node --test
- [x] Deploy server: Postgres setup, /opt/mellucode/, PM2, nginx, SSL Let's Encrypt
- [x] Test produzione end-to-end auth creator
- [ ] Endpoint `/v1/app-auth/*` per end-user app (multi-tenant)
- [ ] Endpoint `/v1/data/{collection}` CRUD generico
- [ ] Endpoint `/v1/files/upload`
- [ ] Endpoint `/v1/email/send`
- [ ] Endpoint `/v1/ai/chat` con quota
- [ ] SDK `platform/sdk/` versione 0.1.0 con auth, data, files, ai
- [ ] Documentazione API (OpenAPI generato da Fastify schemas)
