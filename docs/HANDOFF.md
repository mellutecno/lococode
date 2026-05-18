# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-18
- Tool usati nelle ultime sessioni: Claude Code + Codex

## Stato globale Fase 1
Fase 1 del backend gestito e' avanzata: auth, tenant, app-auth, data API, file storage e SDK base sono implementati e verificati.

Restano da chiudere:
- `/v1/email/send`
- `/v1/ai/chat` con quota/costi
- eventuale build/distribuzione SDK come bundle/npm package

## Commit principali recenti
- `4bc3d51` Add MelluCode frontend SDK
- `5ab8a9b` Add automated test baseline (unit + integration)
- `7a0e67c` Use Ajv for record validation
- `6e936a4` deploy + integration suite verification on prod server
- `d56bdd8` Prepare /v1/files: add @fastify/multipart dep
- `4c4780a` Update HANDOFF with full /v1/files spec
- `6664242` Add /v1/files: managed file storage

## Cosa e' online adesso
Dominio API: `https://mellucode.mellutecno.it`

Server:
- path codice: `/opt/mellucode`
- legacy intoccabile: `/opt/lococode-legacy`
- PM2: `mellucode-api`
- porta interna: `127.0.0.1:5200`
- commit deployato: `6664242`
- health: OK

Database:
- `mellucode_dev` produzione
- `mellucode_test` integration test, separato

Storage file:
- `STORAGE_DIR=/opt/mellucode/storage`
- `UPLOAD_MAX_BYTES=10485760`
- directory creata con permessi `700 root:root`
- `.env` server in `/opt/mellucode/platform/api/.env`, permessi `600`

Nota server:
- Prima del deploy Codex ha trovato una modifica locale server-only a `platform/api/package-lock.json`.
- Non e' stata scartata: e' stata salvata in uno stash sul server con messaggio `server package-lock before files deploy 2026-05-18`.

## API implementate

### Creator MelluCode
- `POST /v1/auth/register`
- `POST /v1/auth/login`
- `POST /v1/auth/refresh`
- `POST /v1/auth/logout`
- `GET /v1/auth/me`

### Tenant / app generate
- `GET /v1/tenants`
- `POST /v1/tenants`

### Utenti finali app generate
- `POST /v1/app-auth/register`
- `POST /v1/app-auth/login`
- `POST /v1/app-auth/refresh`
- `POST /v1/app-auth/logout`
- `GET /v1/app-auth/me`
- `POST /v1/app-auth/change-password`

### Data API multi-tenant
- `GET /v1/data/entities`
- `POST /v1/data/entities`
- `GET /v1/data/{entity}`
- `POST /v1/data/{entity}`
- `GET /v1/data/{entity}/{id}`
- `PATCH /v1/data/{entity}/{id}`
- `DELETE /v1/data/{entity}/{id}`

Validazione record:
- Ajv + ajv-formats
- required, type, format, pattern, enum, min/max, nested object, array constraints
- errori tradotti in italiano breve

### File storage
- `POST /v1/files/upload`
- `GET /v1/files`
- `GET /v1/files/:id`
- `GET /v1/files/:id/content`
- `DELETE /v1/files/:id`

Dettagli file:
- tutti gli endpoint richiedono JWT app-auth
- ogni file e' scoped a `tenant_id`
- owner = app user che ha caricato il file
- lettura: `authenticated`
- delete: `owner_or_admin`
- binari salvati su disco come `{tenantId}/{fileId}`, mai con filename utente
- filename originale, mime, size e metadata salvati su DB
- path traversal difeso in `utils/fileStorage.js`
- delete cancella prima la row DB, poi file su disco best-effort

## SDK
Cartella: `platform/sdk`

Incluso:
- `MelluCode`
- `mc.auth.register/login/logout/me/changePassword`
- refresh automatico access token su `401`
- `mc.entities.list/upsert`
- `mc.data(entity).list/get/create/update/delete`
- `mc.files.upload/list/get/delete/downloadBlob/url`
- `MelluCodeError`
- storage token su `localStorage` in browser, memoria fuori browser

## Test fatti

Locale Windows:
- `platform/api npm test`: 50 unit pass + 1 integration skip prima del deploy files; dopo commit files: 50+ unit pass e integration skip se `TEST_DATABASE_URL` non e' settata
- `platform/sdk npm test`: 7/7 pass
- `git diff --check`: OK

Server produzione/test:
- deploy commit `6664242`
- health HTTPS: OK
- `mellucode-api` PM2 online
- suite server con `TEST_DATABASE_URL` su `mellucode_test`: **93/93 PASS**
- smoke test produzione `/v1/files` via SDK:
  - creator temporaneo creato
  - tenant temporaneo creato
  - admin app login via SDK
  - upload `prova-mellucode.txt` OK
  - list contiene file OK
  - metadata preservati OK
  - download blob byte-per-byte OK
  - delete OK
  - get dopo delete -> `404`
  - creator temporaneo `codex-files-*` rimosso dal DB produzione

Attenzione test:
- la suite integration fa `TRUNCATE` di molte tabelle.
- usare solo `mellucode_test`, mai `mellucode_dev`.
- Per generare `TEST_DATABASE_URL` sul server senza stampare segreti e' stato usato Node + dotenv leggendo `.env`.

## Prossimo passo consigliato
1. Implementare `/v1/email/send`.
2. Decidere SMTP:
   - temporaneo Gmail/app password gia' funzionante altrove
   - oppure provider serio: Resend/Postmark/SES
3. Dopo email: `/v1/ai/chat` con quota/costi.
4. Poi build/distribuzione SDK e integrazione orchestrator che genera frontend usando solo `mellucode-sdk`.

## Note importanti
- Non toccare `/opt/lococode-legacy`.
- Non stampare `.env` o segreti in chat/log.
- La password DB e' comparsa in transcript precedenti: se Antonio vuole, ruotarla di nuovo.
- `npm audit` ha segnalato vulnerabilita' transitive: da affrontare in branch separato, non con `npm audit fix` diretto su questa linea.
