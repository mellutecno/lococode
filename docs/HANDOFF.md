# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-18 (notte)
- Tool usato: Claude Code (Opus 4.7), sessione che ha portato avanti tests + Ajv + deploy + iniziato spec `/v1/files`.

## Stato globale Fase 1
Fase 1 (backend gestito) e' al ~75%. Mancano 3 endpoint per chiuderla:
- **`/v1/files/*`** — la spec dettagliata sta sotto, dep `@fastify/multipart` gia' aggiunta (commit `d56bdd8`), pronta da implementare.
- **`/v1/email/send`** — bloccato su decisione mittente SMTP.
- **`/v1/ai/chat`** — bloccato su spostamento chiave OpenRouter + quota default.

Tutto il resto della Fase 1 e' online, testato, e con copertura test automatica.

---

## Cosa e' stato fatto nelle ultime sessioni

### Sessione precedente (Codex)
Scaffold + deploy iniziale: `mc_users`, `mc_sessions`, `mc_audit_log`, `mc_tenants`, `mc_app_users`, `mc_app_user_sessions`, `mc_app_entities`, `mc_app_records`. Route `/v1/auth`, `/v1/tenants`, `/v1/app-auth`, `/v1/data`. SDK frontend base. Tutto online su `https://mellucode.mellutecno.it`.

### Sessione corrente (Claude Code)
1. **Test baseline** (commit `5ab8a9b`):
   - Refactor mirato: estratti da `routes/data.js` due moduli puri `utils/permissions.js` (`DEFAULT_PERMISSIONS`, `permissionFor`, `canAccess`) e `utils/recordValidation.js` (`validateRecordData`, `isPlainObject`). Estratto `buildApp()` da `server.js` in `app.js` per consentire test via `fastify.inject` senza listen.
   - 29 unit test (`normalize`, `hash`, `permissions`, `recordValidation`).
   - Suite integration 30+ test con `fastify.inject` + Postgres reale in `src/test/integration.test.js`. Si auto-skippa se `TEST_DATABASE_URL` non e' settata. TRUNCATE su tutte le tabelle prima di ogni test (isolamento).
   - `package.json` script `test` aggiornato a `node --test` (glob `src/**/*.test.js` non funzionava su Windows). Aggiunto `test:integration`.

2. **Ajv per validazione record** (commit `7a0e67c`):
   - Aggiunte deps dirette `ajv ^8.17.1` + `ajv-formats ^2.1.1`.
   - Riscritto `validateRecordData` usando Ajv con cache di compilazione (Map keyed by `JSON.stringify(schema)`).
   - Mantenute le semantiche legacy: `required` con `""|null|undefined` = mancante; `null` su campi non-required = ignorato.
   - Schema malformato non crasha piu', ritorna "Schema entita' non valido: ...".
   - Errori Ajv tradotti in italiano breve in `formatAjvError` (require, additionalProperties, type, maxLength, minLength, pattern, format, enum, minimum, maximum, exclusiveMin/Max, multipleOf, minItems, maxItems, uniqueItems). Path nested visualizzato (es. `address.zip`).
   - Tests passati da 9 a 19 (gli originali invariati + 10 nuovi per le nuove keyword).

3. **Deploy + verifica produzione** (commit `6e936a4`):
   - `git pull` + `npm install --omit=dev` + `pm2 restart mellucode-api`.
   - Smoke test contro produzione con entita' `contacts` che usa TUTTE le keyword Ajv nuove (format=email, pattern=CAP, enum=status, minimum/maximum=age): 7 invalid rifiutati con messaggi italiani, 2 valid accettati. Tutti i dati cleanati a fine.
   - Suite integration sul server contro `mellucode_test` (DB creato in questa sessione, owner `mellucode`): **71/71 PASS in ~40s**.

4. **Prep `/v1/files`** (commit `d56bdd8`):
   - Aggiunta dep `@fastify/multipart ^8.3.1`. Niente altro codice.

---

## Stato test
- `cd platform/api && npm test` (locale, no DB): 39 unit PASS, 1 suite integration SKIP.
- `TEST_DATABASE_URL=postgres://mellucode:PASS@127.0.0.1:5432/mellucode_test npm test` sul server: 71/71 PASS.
- Postgres non e' installato sulla macchina Windows di Antonio. La suite integration gira solo sul server (DB separato `mellucode_test`) o quando si imposta CI.
- Per chi gira la integration: la suite fa TRUNCATE su tutte le tabelle ad ogni test. **Mai puntare `TEST_DATABASE_URL` al DB reale.**

## Server (stato corrente)
- Codice deployato: commit `d56bdd8` (la dep multipart e' installata ma non ancora usata).
- PM2: `mellucode-api` online su `127.0.0.1:5200`, healthy.
- DB:
  - `mellucode_dev` (produzione)
  - `mellucode_test` (creato in questa sessione, separato, owner `mellucode`)
- Path codice: `/opt/mellucode/platform/api/`
- `.env`: presente, permessi 600, contiene `DATABASE_URL` + `JWT_SECRET`. **Non contiene ancora** `STORAGE_DIR`, `SMTP_*`, `OPENROUTER_API_KEY`.

---

## NEXT: `/v1/files` — spec pronta da implementare

### Obiettivo
Storage gestito per le app generate. Upload, list, get metadata, get binary, delete. Multi-tenant (sempre scoped al tenant del JWT app-auth). Owner per record (chi ha uploadato), permessi alla `data.js` (`authenticated` per read, `owner_or_admin` per delete).

### Decisioni gia' prese (default proposti, ribaltabili)
- **Storage path**: `${STORAGE_DIR}/{tenant_id}/{file_id}` su disco. `STORAGE_DIR` env, default `./storage` in dev, `/opt/mellucode/storage` in prod.
- **Nome file su disco**: `file_id` (UUID dal DB, mai filename utente — niente path traversal). Filename originale salvato come colonna metadata.
- **Visibilita'**: tutti i file richiedono bearer token per lettura (no URL pubblici signati in Fase 1). Frontend dovra' usare `mc.files.downloadBlob()` + `URL.createObjectURL` per `<img>`.
- **Max size**: `UPLOAD_MAX_BYTES` env, default `10485760` (10 MB).
- **MIME**: nessuna allow-list rigida in Fase 1 — accettare tutto, salvare il mime dichiarato dal client. Aggiungere allow-list se serve in Fase 4.
- **Cleanup su delete**: best-effort. Cancella row DB; poi cancella file su disco con try/catch (se il file non c'e' o e' bloccato, log warning e prosegui — il DB e' la fonte di verita').
- **Cleanup tenant cascade**: quando si cancella un tenant, le row `mc_app_files` vanno via via cascade. I file su disco rimangono (job di GC futuro, non blocca Fase 1).

### DB — nuova tabella `mc_app_files`
Aggiungere a `src/db/schema.js`:
```js
export const mcAppFiles = pgTable("mc_app_files", {
  id: uuid("id").primaryKey().defaultRandom(),
  tenantId: uuid("tenant_id").notNull().references(() => mcTenants.id, { onDelete: "cascade" }),
  ownerAppUserId: uuid("owner_app_user_id").references(() => mcAppUsers.id, { onDelete: "set null" }),
  originalFilename: varchar("original_filename", { length: 255 }).notNull(),
  mimeType: varchar("mime_type", { length: 160 }).notNull(),
  sizeBytes: bigint("size_bytes", { mode: "number" }).notNull(),
  // path RELATIVO a STORAGE_DIR. Es "550e8400-.../9b1d..."
  storagePath: text("storage_path").notNull(),
  metadata: jsonb("metadata").default({}).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => ({
  tenantIdx: index("mc_app_files_tenant_idx").on(t.tenantId),
  ownerIdx: index("mc_app_files_owner_idx").on(t.ownerAppUserId),
  tenantCreatedIdx: index("mc_app_files_tenant_created_idx").on(t.tenantId, t.createdAt),
}));
```
Generare migration `0003_*.sql` con `npm run db:generate` (o scrivere manualmente lo SQL — meta journal e' in `src/db/migrations/meta/_journal.json`, prossimo `idx: 3`).

### Config
Estendere `src/config.js`:
```js
storage: {
  dir: opt("STORAGE_DIR", isDev ? "./storage" : "/opt/mellucode/storage"),
  maxUploadBytes: Number(opt("UPLOAD_MAX_BYTES", "10485760")), // 10 MB
},
```

### Util `src/utils/fileStorage.js`
- `resolveStoragePath(relPath)`: `path.resolve(STORAGE_DIR, relPath)` + verifica che il risolto sia sotto STORAGE_DIR (no path traversal). Throw se no.
- `writeUpload(tenantId, fileId, readStream)`: crea `${STORAGE_DIR}/{tenantId}/` se manca, scrive lo stream. Ritorna `{ sizeBytes, storagePath }` dove `storagePath` e' `{tenantId}/{fileId}` (relativo).
- `openRead(storagePath)`: torna un fs read stream.
- `deleteFile(storagePath)`: `fs.promises.unlink` con try/catch (warning su fallimento).

### Routes `src/routes/files.js`
- Tutte le route usano `currentAppUser` come `data.js` (autenticazione app-auth, scoping tenant).
- `POST /v1/files/upload` — multipart, un solo campo file. Genera UUID, scrive su disco, insert DB, ritorna metadata pubblica.
- `GET /v1/files` — lista paginata file del tenant (limit/offset come data.js).
- `GET /v1/files/:id` — metadata JSON.
- `GET /v1/files/:id/content` — set `Content-Type` + `Content-Disposition: inline; filename="..."` (sanitize filename) + stream binario.
- `DELETE /v1/files/:id` — `owner_or_admin`. Cancella row, poi best-effort unlink.
- Sanitize filename per Content-Disposition (no CRLF, no quotes non escape-ate). Usare `encodeURIComponent` + `filename*=UTF-8''...`.

### Registrazione in `src/app.js`
- `await app.register(multipart, { limits: { fileSize: config.storage.maxUploadBytes, files: 1 } });`
- `await app.register(filesRoutes, { prefix: "/v1/files" });`

### SDK `platform/sdk/`
Aggiungere `mc.files`:
- `upload(file, { metadata })` — `FormData` con `file` (Blob/File) + opzionale `metadata` (JSON string), `POST /v1/files/upload` con bearer.
- `list({ limit, offset })`
- `get(id)` — metadata
- `delete(id)`
- `downloadBlob(id)` — `fetch /v1/files/:id/content` con bearer, ritorna Blob
- `url(id)` — solo helper che ritorna l'URL costruito (utile per debug; non funziona in `<img src>` perche' serve bearer header)

### Test
- Unit `utils/fileStorage.test.js`: path resolution sicura (3 casi di traversal: `..`, path assoluto, simlink), write/read/delete contro tmpdir.
- Integration in `src/test/integration.test.js`:
  - Upload + verifica metadata + verifica file su disco
  - List filtrata per tenant
  - Get content stream
  - Tenant isolation (uploader di tenant A non vede file di tenant B)
  - Permissions: utente non-owner non puo' delete (a meno che role=admin)
  - Limite size (allegare un buffer > maxUploadBytes -> 413 o 400)
  - Cleanup on delete (row + file)

### Deploy
1. `git pull` su `/opt/mellucode/`.
2. `cd /opt/mellucode/platform/api && npm install --omit=dev` (per `@fastify/multipart`).
3. `mkdir -p /opt/mellucode/storage && chown root:root /opt/mellucode/storage && chmod 700 /opt/mellucode/storage` (pm2 gira come root, vedi `pm2 status`).
4. Aggiungere a `/opt/mellucode/platform/api/.env`: `STORAGE_DIR=/opt/mellucode/storage` (e `UPLOAD_MAX_BYTES` se si vuole override).
5. `pm2 restart mellucode-api --update-env`.
6. Smoke test: upload immagine piccola via curl multipart, scarica, delete.
7. Integration suite sul server con `TEST_DATABASE_URL=...mellucode_test npm test`.

### Quirks / attenzioni
- `@fastify/multipart` consuma lo stream. Mai chiamare `file.toBuffer()` PRIMA di scrivere lo stream (consuma due volte).
- Su windows i path hanno backslash, normalizzare a forward slash quando salviamo `storagePath` in DB.
- `bigint` per `size_bytes`: in JS deve essere `{ mode: "number" }` finche' i file restano < 2^53. Se mai si arrivasse a file >8PB cambieremo mode.
- Content-Disposition con caratteri non-ASCII: usare RFC 5987 `filename*=UTF-8''<encodeURIComponent>`.

---

## NEXT-NEXT: `/v1/email/send` (dopo /v1/files)

Bloccato su 2 decisioni di Antonio:
1. **Mittente SMTP**: riusare `approfittoffro@gmail.com` (app password gia' esistente sul server in `/opt/lococode-legacy/web/.env`?) o configurare nuovo `noreply@mellucode.mellutecno.it`?
2. **Provider**: Gmail SMTP funziona ma ha limiti (500/giorno). Per produzione vera meglio Resend/Postmark/SES. Per Fase 1 va bene Gmail/Sendgrid/qualsiasi SMTP standard.

Config gia' presente in `src/config.js` (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `SMTP_FROM`). Manca solo l'implementazione e la decisione.

Implementazione consigliata: `nodemailer` + template Handlebars/EJS minimi. Route `POST /v1/email/send` con `{ to, subject, template, data }`. Audit log.

---

## NEXT-NEXT-NEXT: `/v1/ai/chat` con quota

Bloccato su 3 decisioni:
1. **Chiave OpenRouter**: spostare `LOCOCODE_OPENROUTER_KEY` da `/opt/lococode-legacy/web/.env` a `/opt/mellucode/platform/api/.env` (rinominare `OPENROUTER_API_KEY`).
2. **Modello default**: quale modello scegliamo come default per le app generate? (claude-sonnet-4-6? gpt-4o-mini? Llama 3.1?)
3. **Quota trial**: quanti token/euro per tenant in trial?

Da implementare anche:
- Tabella `mc_ai_quotas` (residuo per tenant)
- Tabella `mc_ai_usage` (log per-call: modello, prompt tokens, completion tokens, costo)
- Route proxy che decrementa quota prima della chiamata, riaccredita su errore upstream.

---

## Problemi / attenzioni globali
- `npm audit` segnala 8+ vulnerabilita' transitive (1 critica, 6 high). Da rivedere a parte — molte vengono da deps di drizzle-kit/argon2/fastify. `npm audit fix` da provare in branch separato.
- Lo SDK in `platform/sdk/` ha la sua suite test (gia' esistente, immutata).
- Sicurezza: la password del DB `mellucode_dev` e' apparsa nei transcript Claude (questa sessione l'ha usata per girare la suite integration). Se preoccupa, ruotarla come gia' fatto in passato — il `.env` server e' l'unico posto autoritativo.

## Commit ultimi 5
- `d56bdd8` Prepare /v1/files: add @fastify/multipart dep
- `6e936a4` Update HANDOFF after deploy + integration suite verification on prod server
- `7a0e67c` Use Ajv for record validation (format, pattern, enum, min/max, nested)
- `5ab8a9b` Add automated test baseline (unit + integration)
- `4bc3d51` Add MelluCode frontend SDK
