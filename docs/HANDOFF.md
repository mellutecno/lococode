# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-17
- Tool usato: Codex

## Obiettivo della sessione
Consolidare l'inizio della v2 MelluCode e portare online il primo backend gestito `mellucode-api` con auth creator reale.

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

## Git
- Branch: `mellucode-v2`
- Commit principali:
  - `75f0e0d` rebrand a MelluCode
  - `ad6087f` scaffold API gestito
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
  - `nginx -t` -> OK
  - `pm2 status mellucode-api` -> online

## Stato finale
- `mellucode-api` e' online e risponde via HTTPS.
- Auth creator base funziona end-to-end.
- Migrations DB vengono applicate al boot.
- La v1 resta archiviata in `/opt/lococode-legacy` e tag `legacy-v1`.

## Problemi / attenzioni
- La porta 5000 sul server era gia occupata da un servizio `gunicorn`, quindi MelluCode usa `5200`.
- PM2 va avviato direttamente con `src/server.js`, non con `npm start --cwd ...`.
- Mancano test automatici veri per auth: attualmente c'e' solo smoke test manuale.
- Il logger PM2 contiene vecchi errori del primo avvio sbagliato con npm; il servizio corrente e' sano.
- Non rilanciare il vecchio comando che rigenera `/tmp/mellucode-db-pass.tmp`: cambierebbe la password DB e romperebbe il `.env`.

## Prossimo passo consigliato
1. Aggiungere test automatici auth con `node:test` o Vitest.
2. Implementare `/v1/app-auth/*` per gli utenti finali delle app generate.
3. Implementare modello tenant:
   - `mc_tenants`
   - `mc_app_users`
   - `mc_app_user_sessions`
4. Implementare `/v1/data/{collection}` CRUD generico multi-tenant.
5. Iniziare `platform/sdk/` per frontend generati.
