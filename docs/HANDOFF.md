# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-17
- Tool usato: Codex

## Obiettivo della sessione
Consolidare l'inizio della v2 MelluCode e portare online il primo backend gestito `mellucode-api` con auth creator reale. Nelle fasi successive sono stati aggiunti il primo blocco multi-tenant, l'auth degli utenti finali delle app generate e la prima Data API gestita.

## Modifiche fatte
- Creato/committato scaffold `platform/api/`:
  - Fastify API
  - PostgreSQL + Drizzle
  - argon2 password hashing
  - JWT auth
  - endpoint `/v1/health`
  - endpoint `/v1/auth/register`
  - endpoint `/v1/auth/login`
  - endpoint `/v1/auth/refresh`
  - endpoint `/v1/auth/logout`
  - endpoint `/v1/auth/me`
- Generata migration iniziale Drizzle:
  - `mc_users`
  - `mc_sessions`
  - `mc_audit_log`
- Aggiornata architettura in `docs/architecture.md`.
- Aggiornato `README.md` con stato API produzione.
- Aggiunto modello multi-tenant:
  - `mc_tenants`
  - `mc_app_users`
  - `mc_app_user_sessions`
- Aggiunta migration Drizzle `0001_famous_quentin_quire.sql`.
- Aggiunte route creator protette:
  - `GET /v1/tenants`
  - `POST /v1/tenants`
- Aggiunte route utenti finali app generate:
  - `POST /v1/app-auth/register`
  - `POST /v1/app-auth/login`
  - `POST /v1/app-auth/refresh`
  - `POST /v1/app-auth/logout`
  - `GET /v1/app-auth/me`
  - `POST /v1/app-auth/change-password`
- Estratti helper `normalizeEmail` e `slugify` in `platform/api/src/utils/normalize.js`.
- Aggiunto modello dati generico per le app generate:
  - `mc_app_entities`
  - `mc_app_records`
- Aggiunta migration Drizzle `0002_chemical_namor.sql`.
- Aggiunta route Data API:
  - `GET /v1/data/entities`
  - `POST /v1/data/entities`
  - `GET /v1/data/{entity}`
  - `POST /v1/data/{entity}`
  - `GET /v1/data/{entity}/{id}`
  - `PATCH /v1/data/{entity}/{id}`
  - `DELETE /v1/data/{entity}/{id}`
- Le entita' usano `json_schema` per una validazione base: required, type, maxLength, additionalProperties.
- I record sono sempre filtrati per `tenant_id`; update/delete rispettano permessi base (`authenticated`, `admin`, `owner_or_admin`, `none`).

## Git
- Branch: `mellucode-v2`
- Commit principali:
  - `75f0e0d` rebrand a MelluCode
  - `ad6087f` scaffold API gestito
  - `03cdc31` handoff deploy API
  - `7dd1900` tenant + app user auth APIs
  - `69879ca` handoff app-auth deploy
  - `88de15e` managed tenant data API
- Push fatto: si
- Stato al termine previsto: pulito dopo commit finale di handoff.

## Server
- Dominio: `https://mellucode.mellutecno.it`
- Path server nuovo: `/opt/mellucode`
- Path legacy da non toccare: `/opt/lococode-legacy`
- Processo PM2: `mellucode-api`
- Porta interna reale API: `127.0.0.1:5200`
- Nginx vhost: `/etc/nginx/sites-available/mellucode.mellutecno.it`
- SSL Let's Encrypt creato per `mellucode.mellutecno.it`
- Database:
  - PostgreSQL locale
  - DB: `mellucode_dev`
  - user: `mellucode`
- Sicurezza:
  - La password DB comparsa in chat e salvata in `/tmp/mellucode-db-pass.tmp` e' stata ruotata.
  - `/tmp/mellucode-db-pass.tmp` e' stato eliminato.
  - La password attuale sta solo in `/opt/mellucode/platform/api/.env` con permessi `600`.

## Test fatti
- Locale:
  - syntax check su tutti i file JS in `platform/api/src`
  - `npm test` (nessuna suite ancora presente, esito senza errori)
  - `git diff --check`
- Produzione:
  - `https://mellucode.mellutecno.it/v1/health` -> `200`
  - register nuovo utente smoke test -> OK
  - login utente smoke test -> OK
  - `/v1/auth/me` con bearer token -> OK
  - creazione tenant con admin iniziale -> OK
  - login admin app generata via `/v1/app-auth/login` -> OK
  - `/v1/app-auth/me` con token app -> OK
  - cambio password admin app generata -> OK
  - register utente finale app generata -> OK
  - refresh token app generata -> OK
  - logout app generata -> `204`
  - creazione entita' Data API come admin app -> OK
  - creazione record Data API come admin app -> OK
  - lista record Data API -> OK
  - registrazione utente finale e creazione record -> OK
  - update record dal proprietario -> OK
  - delete negata a utente non admin quando `delete=admin` -> `403`
  - delete concessa ad admin -> `204`
  - `nginx -t` -> OK
  - `pm2 status mellucode-api` -> online
- Pulizia test data:
  - eliminati dal DB i soli creator temporanei `codex-smoke-*` e `codex-logout-*`; cascade ha rimosso i tenant temporanei collegati.
  - eliminato anche il creator temporaneo `codex-data-*`; cascade ha rimosso tenant, entita', record e utenti app di test.

## Stato finale
- `mellucode-api` e' online e risponde via HTTPS.
- Auth creator base funziona end-to-end.
- Tenant e auth utenti finali delle app generate funzionano end-to-end.
- Data API multi-tenant base funziona end-to-end.
- Migrations DB vengono applicate al boot.
- La v1 resta archiviata in `/opt/lococode-legacy` e tag `legacy-v1`.

## Problemi / attenzioni
- La porta 5000 sul server era gia occupata da un servizio `gunicorn`, quindi MelluCode usa `5200`.
- PM2 va avviato direttamente con `src/server.js`, non con `npm start --cwd ...`.
- Mancano test automatici veri per auth/app-auth/data: attualmente ci sono smoke test manuali in produzione.
- La validazione `json_schema` della Data API e' volutamente base; prima di produzione commerciale va rafforzata con Ajv completo e test automatici.
- Il logger PM2 contiene vecchi errori del primo avvio sbagliato con npm; il servizio corrente e' sano.
- Non rilanciare il vecchio comando che rigenera `/tmp/mellucode-db-pass.tmp`: cambierebbe la password DB e romperebbe il `.env`.
- Se si testa logout app-auth da PowerShell, `Invoke-WebRequest` puo' comportarsi male con `204 No Content`; usare `curl.exe` o un client HTTP normale. L'endpoint risponde correttamente `204`.

## Prossimo passo consigliato
1. Aggiungere test automatici auth/app-auth/data con `node:test` o Vitest.
2. Iniziare `platform/sdk/` con `auth` + `data`.
3. Rafforzare la validazione JSON Schema con Ajv.
4. Implementare `/v1/files/upload`.
5. Poi email transazionali e AI proxy con quota/costi.
