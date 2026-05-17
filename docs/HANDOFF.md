# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-18 (sera)
- Tool usato: Claude Code (Opus 4.7)

## Obiettivo della sessione
Costruire la prima baseline di test automatici per `mellucode-api`. Prima di questa sessione esistevano solo smoke test manuali in produzione (vedi handoff precedente di Codex). Obiettivo: unit test puri per i moduli "puri" gia' esistenti e integration test (fastify.inject + PostgreSQL) pronti da girare contro un DB di test quando disponibile.

## Modifiche fatte

### Refactor mirato per testabilita'
- Estratti da `platform/api/src/routes/data.js`:
  - `DEFAULT_PERMISSIONS`, `permissionFor`, `canAccess` -> nuovo `platform/api/src/utils/permissions.js`
  - `isPlainObject`, `validateRecordData` -> nuovo `platform/api/src/utils/recordValidation.js`
- Estratto `buildApp()` da `platform/api/src/server.js` in nuovo `platform/api/src/app.js`. `server.js` ora fa solo: build + migrations + listen + shutdown. Lo stesso `buildApp()` viene usato dai test via `fastify.inject` senza listen.

### Test aggiunti
- `platform/api/src/utils/normalize.test.js` — 6 test (email/slug/key normalization).
- `platform/api/src/utils/hash.test.js` — 5 test (argon2 hash/verify, token generation + sha256).
- `platform/api/src/utils/permissions.test.js` — 9 test (DEFAULT_PERMISSIONS, permissionFor fallback, canAccess per ogni mode + edge cases).
- `platform/api/src/utils/recordValidation.test.js` — 9 test (validazione required, types, maxLength, additionalProperties, payload non-object).
- `platform/api/src/test/integration.test.js` — 30+ test integration (fastify.inject + DB reale), auto-skip se `TEST_DATABASE_URL` non e' settata. Copre:
  - `GET /v1/health`
  - `/v1/auth/*` (register / login / refresh + rotation / logout / me, edge cases password duplicate/invalid)
  - `/v1/tenants` (auth required, create + initial admin, duplicate slug, scoping per owner)
  - `/v1/app-auth/*` (login admin, login wrong tenant/password, end-user register + public-registration off, change-password full cycle, rifiuto JWT creator come app-auth)
  - `/v1/data/*` (entity definita solo da admin, validazione required, CRUD record, isolamento per tenant, owner_or_admin, delete=admin, entita' inesistente)

### Tooling
- `package.json` script `test` aggiornato da `node --test src/**/*.test.js` (non funziona su Windows perche' la shell non espande il glob) a `node --test` (auto-discovery ricorsiva, supportata da Node 20+).
- Aggiunto script `test:integration` per lanciare solo la suite integration.

## Stato test
- `cd platform/api && npm test`:
  - 29 unit test PASS
  - 1 suite integration SKIP (correttamente, manca `TEST_DATABASE_URL`)
- Per girare la suite integration: creare un DB di test e settare la variabile prima di `npm test`:
  - PowerShell: `$env:TEST_DATABASE_URL = "postgres://USER:PASS@127.0.0.1:5432/mellucode_test"`
  - Bash: `TEST_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/mellucode_test npm test`
  - La suite applica migrations all'avvio e fa TRUNCATE su tutte le tabelle prima di ogni test (isolamento totale).
- Postgres non e' installato localmente sulla macchina Windows di Antonio: la suite integration va girata o sul server di produzione (in un DB separato, MAI `mellucode_dev`) o quando si imposta una CI con PG.

## Modifiche al codice di produzione (non solo test)
- `src/routes/data.js` rifattorizzato per importare da `utils/permissions.js` e `utils/recordValidation.js`. Comportamento identico al codice precedente; gli stessi smoke test manuali in produzione devono continuare a passare (non eseguiti in questa sessione perche' modifiche locali).
- `src/server.js` ora deriva da `src/app.js` ma il comportamento di avvio (porta, host, logger, migrations, shutdown) e' identico.

## Git
- Branch: `mellucode-v2`
- Stato pre-commit: dirty (file aggiunti e modificati di cui sopra).
- Commit atteso dopo questo HANDOFF: "Add automated test baseline (unit + integration)".
- Push fatto: no (da fare).

## Server
- Nessuna modifica al server in questa sessione.
- Per girare la suite integration in produzione: creare DB `mellucode_test` separato (NON usare `mellucode_dev`), settare `TEST_DATABASE_URL`, `npm test`. La TRUNCATE distrugge tutti i dati nel DB di test ad ogni test — quindi MAI puntare al DB reale.

## Test fatti
- Locale (Windows):
  - `node --check` su tutti i file nuovi/modificati: OK
  - `npm test` (senza `TEST_DATABASE_URL`):
    - 29 unit PASS / 0 fail / 1 skip
- Produzione: niente (modifiche solo locali).

## Stato finale
- Esiste una baseline di test automatici eseguibile cold (`npm test`) che copre la logica pura (helpers, validazione, permessi).
- Esiste una suite integration completa che gira appena qualcuno gli da' un PG di test — la stessa che usera' la CI quando la metteremo in piedi.
- Codice di produzione invariato funzionalmente (refactor solo strutturale).

## Problemi / attenzioni
- Le modifiche a `data.js` (refactor che importa da `utils/permissions.js` e `utils/recordValidation.js`) non sono ancora state testate contro produzione: prima del prossimo deploy va fatto smoke test manuale come quelli del precedente handoff (creazione entita', create/list/update/delete record con permessi diversi).
- La suite integration usa `TRUNCATE ... CASCADE RESTART IDENTITY` su tutte le tabelle ad ogni `beforeEach`. **Non puntare mai** `TEST_DATABASE_URL` al DB reale.
- Validazione `json_schema` server-side e' sempre quella "light" originale (estratta tale e quale in `recordValidation.js`). Quando si fa il giro Ajv (TODO HANDOFF precedente), questi stessi test saranno il safety net per il refactor.
- Lo SDK in `platform/sdk/` ha la sua suite test (gia' esistente, immutata in questa sessione).

## Prossimo passo consigliato
1. Smoke test manuale post-refactor su produzione: creare entita', creare record, update/delete con vari ruoli (rifare la sequenza del precedente handoff sezione "Test fatti / Produzione").
2. Far girare la suite integration almeno una volta: creare `mellucode_test` su Postgres locale del server (NON il DB di produzione), settare `TEST_DATABASE_URL`, `npm test`.
3. Sostituire la validazione `validateRecordData` con Ajv completo (i test attuali la inquadrano per evitare regressioni).
4. Implementare `/v1/files/upload` + `mc.files` SDK (richiede conferma path storage).
5. Implementare `/v1/email/send` (richiede conferma mittente SMTP).
6. Implementare `/v1/ai/chat` con quota (richiede chiave OpenRouter da `/opt/lococode-legacy/web/.env` e quota trial di default).
