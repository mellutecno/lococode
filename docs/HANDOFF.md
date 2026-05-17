# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-18 (sera)
- Tool usato: Claude Code (Opus 4.7)

## Obiettivo della sessione
1. Costruire la prima baseline di test automatici per `mellucode-api` (unit + integration con fastify.inject + Postgres).
2. Sostituire la validazione `validateRecordData` "light" con Ajv full (draft-07 + ajv-formats), mantenendo invariate le semantiche legacy (stringa vuota = mancante, null su campi opzionali ignorato).

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

### Ajv: validazione record robusta
- Aggiunte deps dirette: `ajv ^8.17.1` + `ajv-formats ^2.1.1` (erano gia' presenti come transitive di `@fastify/*`).
- Riscritto `src/utils/recordValidation.js` per usare Ajv con cache di compilazione (Map keyed by `JSON.stringify(schema)`). Stesso schema -> stessa validate function compilata una sola volta.
- Mantenute le semantiche custom del codice v1:
  - `required` con valore `undefined | null | ""` -> messaggio "Campo obbligatorio mancante" (Ajv non gestisce nativamente stringa vuota / null come "missing").
  - `null` su campi NON required -> ignorato nella validazione (Ajv altrimenti lo tratterebbe come tipo mismatch).
- Schema malformati (es. `type: "telepathy"`) ora ritornano un errore esplicito "Schema entita' non valido: ..." invece di far crashare la richiesta.
- Errori Ajv tradotti in italiano breve in `formatAjvError` (require / additionalProperties / type / maxLength / minLength / pattern / format / enum / minimum / maximum / exclusiveMin/Max / multipleOf / minItems / maxItems / uniqueItems). Path nested (es. `address.zip`) viene mostrato nel messaggio.
- Nuove validazioni ora supportate dalla Data API (definibili dall'orchestrator nel `mc_app_entities.json_schema`):
  - `format`: email, uri, uuid, date, date-time, ipv4, ipv6, ecc. (via `ajv-formats`)
  - `pattern` (regex)
  - `enum`
  - `minimum`, `maximum`, `exclusiveMinimum`, `exclusiveMaximum`, `multipleOf`
  - `minLength`
  - `minItems`, `maxItems`, `uniqueItems` su array
  - Validazione di oggetti nested
- `recordValidation.test.js` esteso da 9 a 19 test (i 9 originali continuano a passare invariati, i 10 nuovi coprono le nuove capacita').

## Stato test
- `cd platform/api && npm test` (locale, senza DB):
  - 39 unit test PASS (29 baseline + 10 nuovi su Ajv)
  - 1 suite integration SKIP (correttamente, manca `TEST_DATABASE_URL`)
- `cd platform/api && TEST_DATABASE_URL=... npm test` (sul server contro `mellucode_test`):
  - 71/71 PASS in ~40s (39 unit + 32 integration). Validato sia il refactor `data.js` -> `utils/permissions.js` + `utils/recordValidation.js` sia tutte le route end-to-end.
- Per girare la suite integration: creare un DB di test e settare la variabile prima di `npm test`:
  - PowerShell: `$env:TEST_DATABASE_URL = "postgres://USER:PASS@127.0.0.1:5432/mellucode_test"`
  - Bash: `TEST_DATABASE_URL=postgres://USER:PASS@127.0.0.1:5432/mellucode_test npm test`
  - La suite applica migrations all'avvio e fa TRUNCATE su tutte le tabelle prima di ogni test (isolamento totale).
- Postgres non e' installato localmente sulla macchina Windows di Antonio: la suite integration va girata o sul server di produzione (in un DB separato, MAI `mellucode_dev`) o quando si imposta una CI con PG.

## Modifiche al codice di produzione (non solo test)
- `src/routes/data.js` rifattorizzato per importare da `utils/permissions.js` e `utils/recordValidation.js`.
- `src/server.js` ora deriva da `src/app.js` ma il comportamento di avvio (porta, host, logger, migrations, shutdown) e' identico.

## Deploy effettuato (sessione corrente)
- `git pull` su `/opt/mellucode/` (passa a `7a0e67c`).
- `npm install --omit=dev` in `/opt/mellucode/platform/api/`: aggiunge `ajv@8.20.0` + `ajv-formats@2.1.1` come deps dirette (npm audit segnala 8 vulnerabilita' in transitive — da rivedere a parte, vedi sezione "Problemi").
- `pm2 restart mellucode-api`: migrations idempotenti, server online su `127.0.0.1:5200`, health 200.
- Smoke test contro produzione con una nuova entita' `contacts` che usa TUTTE le keyword Ajv aggiunte:
  - 7 casi invalidi rifiutati con i messaggi italiani attesi (email format, pattern CAP, enum status, age >= 18, age <= 120, required mancante, required stringa vuota).
  - 2 casi validi accettati (201).
  - Tutti i dati di smoke test eliminati a fine corsa (verificato: 0 tenant residui).
- Suite integration eseguita sul server contro `mellucode_test` (DB separato, creato in questa sessione, owner `mellucode`): 71/71 PASS.

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
1. **(Da decidere con Antonio)** ordine dei 3 endpoint mancanti per chiudere Fase 1:
   - `/v1/files/upload` + `mc.files` SDK (richiede conferma path storage, default proposto `/opt/mellucode/storage/{tenant_id}/{file_id}`).
   - `/v1/email/send` (richiede conferma mittente SMTP: riusare `approfittoffro@gmail.com` o nuovo `noreply@mellucode.mellutecno.it`?).
   - `/v1/ai/chat` con quota (richiede spostare chiave `LOCOCODE_OPENROUTER_KEY` da `/opt/lococode-legacy/web/.env` al nuovo `.env` e definire quota trial default).
2. Eventuale `npm audit fix` sul server per le 8 vulnerabilita' transitive segnalate (1 critica, 6 high, 1 moderate). Da fare a parte, verificare prima cosa tocca.
3. Considerare CI (GitHub Actions) che esegua `npm test` sia unit che integration ad ogni push su `mellucode-v2`.
