# HANDOFF MelluCode

## Data / autore
- Data: 2026-05-18 (notte)
- Tool usati nelle ultime sessioni: Claude Code + Codex
- Ultimo lavoro: demo template "Palestra" (Claude Code)

## Stato globale Fase 1
Fase 1 del backend gestito e' **chiusa**: auth, tenant, app-auth, Data API, file storage, invio email gestito, AI proxy con quota/costi e SDK base sono implementati, testati e verificati in produzione.

E' online la **prima demo end-to-end**: gestione palestra, costruita usando SOLO il backend MelluCode + SDK (zero codice server custom). E' visitabile, e' la prova tangibile che lo stack v2 regge.

Restano da chiudere:
- eventuale build/distribuzione SDK come bundle/npm package
- orchestrator AI Fase 2 (genera schema + frontend da prompt utente)

## Commit principali recenti
- `4bc3d51` Add MelluCode frontend SDK
- `5ab8a9b` Add automated test baseline (unit + integration)
- `7a0e67c` Use Ajv for record validation
- `6e936a4` deploy + integration suite verification on prod server
- `d56bdd8` Prepare /v1/files: add @fastify/multipart dep
- `4c4780a` Update HANDOFF with full /v1/files spec
- `6664242` Add /v1/files: managed file storage
- `c665de7` Update handoff after files deploy
- `04decef` Add managed email send endpoint
- `8269c29` Correct SMTP backup path in handoff
- `00d571a` Add managed AI chat with quota tracking

## Cosa e' online adesso
Dominio API: `https://mellucode.mellutecno.it`

Server:
- path codice: `/opt/mellucode`
- legacy intoccabile: `/opt/lococode-legacy`
- PM2: `mellucode-api`
- porta interna: `127.0.0.1:5200`
- commit deployato: `00d571a`
- health: OK
- SMTP reale configurato e smoke test invio OK
- OpenRouter reale configurato in `.env` copiando server-side la vecchia `LOCOCODE_OPENROUTER_KEY` come `OPENROUTER_API_KEY` senza stampare segreti

Database:
- `mellucode_dev` produzione
- `mellucode_test` integration test, separato
- nuova tabella email: `mc_email_log`
- nuove tabelle AI: `mc_ai_quotas`, `mc_ai_usage`

Storage file:
- `STORAGE_DIR=/opt/mellucode/storage`
- `UPLOAD_MAX_BYTES=10485760`
- directory creata con permessi `700 root:root`
- `.env` server in `/opt/mellucode/platform/api/.env`, permessi `600`
- backup `.env` prima della configurazione OpenRouter: `/opt/mellucode-backups/env/.env.backup.openrouter.<timestamp>`

Nota server:
- Prima del deploy files Codex aveva trovato una modifica locale server-only a `platform/api/package-lock.json`.
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

### Email
- `POST /v1/email/send`

Dettagli email:
- endpoint protetto da JWT app-auth
- per ora puo' inviare solo un utente app con ruolo `admin`
- non e' un relay libero: `from` e' sempre `SMTP_FROM` del server
- destinatari normalizzati, deduplicati e limitati a 10 per request
- richiede `subject` e almeno uno tra `text` o `html`
- supporta `replyTo` e `metadata`
- scrive audit tecnico in `mc_email_log` con tenant, app user, destinatari, subject, stato e provider message id
- in test usa `SMTP_TRANSPORT=json`, quindi non invia email reali
- in produzione SMTP reale e' configurato in `.env` senza `SMTP_TRANSPORT`
- sorgente iniziale credenziali: variabili mail gia' presenti su `/opt/approfittOffro/execution/.env`, copiate server-side senza stamparle
- e' stato creato backup fuori dal repo in `/opt/mellucode-backups/env/.env.backup.smtp.<timestamp>`

### AI
- `POST /v1/ai/chat`
- `GET /v1/ai/quota`
- `GET /v1/ai/usage`

Dettagli AI:
- endpoint protetti da JWT app-auth
- provider: OpenRouter
- la chiave OpenRouter resta solo server-side
- i modelli accettati sono limitati da `OPENROUTER_ALLOWED_MODELS`; se non configurata, e' ammesso solo `OPENROUTER_DEFAULT_MODEL`
- quota per tenant in `mc_ai_quotas`
- ogni chiamata riuscita/errore viene loggata in `mc_ai_usage`
- i costi sono salvati in micro-crediti (`1 credito = 1_000_000 micro-crediti`)
- il costo usa `usage.cost` quando OpenRouter lo restituisce; altrimenti usa stima token conservativa
- default quota mensile: `AI_DEFAULT_MONTHLY_CREDITS` (default codice: `0`, quindi AI bloccata finche' non abilitata da config/billing)
- riserva pre-call: `AI_RESERVE_PER_REQUEST_CREDITS`, per impedire chiamate quando il credito residuo e' troppo basso
- in test usa `OPENROUTER_TRANSPORT=mock`, quindi non consuma token reali

## SDK
Cartella: `platform/sdk`

Incluso:
- `MelluCode`
- `mc.auth.register/login/logout/me/changePassword`
- refresh automatico access token su `401`
- `mc.entities.list/upsert`
- `mc.data(entity).list/get/create/update/delete`
- `mc.files.upload/list/get/delete/downloadBlob/url`
- `mc.email.send`
- `mc.ai.chat/quota/usage`
- `MelluCodeError`
- storage token su `localStorage` in browser, memoria fuori browser

## Test fatti

Locale Windows:
- `platform/api npm test`: 58 pass + 1 integration skip se `TEST_DATABASE_URL` non e' settata
- `platform/sdk npm test`: 9/9 pass
- `git diff --check`: OK

Server produzione/test:
- deploy commit `00d571a`
- health HTTPS: OK
- `mellucode-api` PM2 online
- tabelle `mc_email_log`, `mc_ai_quotas`, `mc_ai_usage` presenti su `mellucode_dev` tramite migration applicate al boot
- suite server con `TEST_DATABASE_URL` su `mellucode_test`, `SMTP_TRANSPORT=json` e `OPENROUTER_TRANSPORT=mock`: **109/109 PASS**
- smoke test produzione `/v1/email/send` reale:
  - creator temporaneo `smtp-smoke-*` creato
  - tenant temporaneo creato
  - admin app login OK
  - invio email verso `SMTP_FROM` OK (`acceptedCount: 1`)
  - creator temporaneo rimosso dal DB produzione con cascade
- i test email coprono:
  - admin app invia email e scrive `mc_email_log`
  - app user non-admin riceve `403`
  - creator JWT rifiutato con `401`
  - destinatario non valido e contenuto vuoto rifiutati con `400`
- i test AI coprono:
  - app user chiama `/v1/ai/chat` e scrive usage + quota
  - `/v1/ai/quota` ritorna quota corrente
  - hard limit blocca prima della chiamata provider con `402`
  - creator JWT rifiutato e modello non consentito bloccato
- smoke test reale produzione `/v1/ai/chat`:
  - `OPENROUTER_API_KEY` presente in produzione
  - creator temporaneo `ai-smoke-*` creato
  - tenant temporaneo creato
  - quota minima inserita in `mc_ai_quotas`
  - chiamata reale OpenRouter OK con modello `openai/gpt-4o-mini`
  - costo registrato: `0.000007` crediti
  - quota scalata e 1 row scritta in `mc_ai_usage`
  - creator temporaneo rimosso dal DB produzione con cascade

Attenzione test:
- la suite integration fa `TRUNCATE` di molte tabelle.
- usare solo `mellucode_test`, mai `mellucode_dev`.
- Per generare `TEST_DATABASE_URL` sul server senza stampare segreti e' stato usato Node + dotenv leggendo `.env`.

## Bar di qualita' estetica (regola assoluta)

Vedi `~/.claude/projects/.../memory/feedback_design_quality_bar.md`. **Tutte le UI MelluCode** — Console, demo, template di partenza per Fase 2, app generate dall'orchestrator AI — devono essere a livello premium SaaS/AI (Awwwards/CSSDA/Land-book/Godly), mai grafica base/generica. Quando arrivera' la pipeline orchestrator Fase 2, questa direttiva va iniettata nei system prompt + linkati Console e template come few-shot.

**Qualita' FISSA, palette VARIABILE.** Il design system e' palette-agnostic: token Tailwind `ink.*` (sfondi) + `accent.*` (accento) + shadow `glow-*` coerente con l'accento. Cambiando solo quei tre blocchi nel `tailwind.config.js` la stessa app si veste diversa senza toccare i componenti.

Preset palette per topic (libreria da espandere in Fase 2):
- Sport/palestra: dark ink + violet electric (vedi `platform/templates/palestra/`)
- Dev tool/platform: pure black + cyan electric (vedi `platform/console/`)
- Ristorante: dark warm + amber/terracotta — da fare
- Studio legale/finance: light cream o navy dark + accent oro — da fare
- Wellness/yoga: off-white o sage dark + sage/eucalyptus — da fare
- Beauty/fashion: cream o burgundy + fuchsia/rose — da fare

## MelluCode Console (front-end del prodotto, root dominio)

🌐 https://mellucode.mellutecno.it/

E' il dashboard del **creator** — chi compra MelluCode entra qui, vede le sue app, ne crea di nuove. Prima di oggi la root dominio era proxata interamente all'API; ora la root serve la Console (statica) e l'API risponde solo su `/v1/*`.

- **Pagine**:
  - `/login` — login + registrazione creator (tabs), split layout con hero a sinistra (palette + pitch + features pills) e form a destra, password validation min 8.
  - `/` — dashboard "Le tue app": stats row (totale/attive/in trial), search per nome+slug, grid card con plan/status pill + bottone "Apri" e link a `/app/:slug`, **empty state** illustrato con CTA, **skeleton** durante il load, gestione 401 con auto-refresh trasparente.
  - **Modale "Crea app"** (premium con backdrop blur + scale-in, top-bar accento gradient, esc/backdrop-close): nome -> slug auto-derivato, advanced collapsible per admin app email/password + publicRegistration toggle.
  - `/app/:slug` — detail card hero con avatar generato dalla prima lettera del nome, pill plan/status/registration, info rows (slug copiabile, URL pubblico cliccabile, data creazione, tenant id), panel laterale "Frontend AI" placeholder per Fase 2.
- **Sorgente**: `platform/console/` (Vite + React + Tailwind + lucide). `src/lib/api.js` parla con `/v1/auth/*` e `/v1/tenants` direttamente (la Console NON usa l'SDK perche' l'SDK e' pensato per app-auth, qui serve auth creator).
- **Palette**: pure black + cyan electric (vibe Vercel/Cursor) — **scelta voluta diversa dalla palestra** (dark + violet) per dimostrare in pratica che il design system e' palette-agnostic. Token `ink.*` + `accent.*` cambiano, tutto il resto (componenti, shadow `glow`, animation, glass) e' identico.
- **Deploy**:
  - static in `/opt/mellucode/console/` (root:root, perms default)
  - nginx vhost riscritto: `location /v1/ -> proxy 5200`, `location /demo/palestra/ + /demo/palestra/assets/ -> alias`, `location /assets/ -> alias console assets con cache 1y`, `location / -> root console + try_files SPA fallback`
  - **`/index.html` ha cache no-store** per pickup deploy nuovi; asset hashati restano cache 1y
  - backup vhost pre-modifica: `/opt/mellucode-backups/nginx/mellucode.mellutecno.it.before-console.20260518-080640`
- **Verifiche fatte this session**:
  - `GET /` → 200 HTML Console
  - `GET /v1/health` → 200 (API ancora online)
  - `GET /demo/palestra/` → 200 (demo non rotta)
  - `GET /app/anything-here` → 200 SPA fallback all'index Console
  - `GET /assets/index-*.js` → 200 application/javascript
  - End-to-end via curl: register creator → list tenants (0) → POST tenant → list (1, slug presente) → cleanup DB. Tutto OK.

### Cosa **NON** fa ancora la Console
- Non ha pagina "Profilo / Impostazioni" (logout c'e' nella topbar).
- Non mostra stats per-tenant (record count, file count, AI credits). Servirebbe un endpoint aggregato `/v1/tenants/:id/stats` lato API. Annotato come prossimo step.
- Non mostra l'admin app email creato col tenant (la response del POST contiene `initialAdmin` ma la lista no). Migliorabile aggiungendo `?include=admin` lato API o salvando lo stato lato Console post-create.
- Niente billing/abbonamento UI. Niente recupero password.
- Il "Crea app" crea solo il tenant — l'admin app deve essere configurato a parte (campo opzionale nel form). Per la Fase 2, il flusso "Crea app" dovra' anche aprire il prompt-to-app generator.

## Demo live `palestra-demo` (UI premium dark, design system riferimento)

🌐 https://mellucode.mellutecno.it/demo/palestra/

Questa demo e' stata **rifatta a livello premium** (commit `___`) per essere il riferimento estetico che l'AI Fase 2 dovra' imparare. Stack visivo:

- **Palette**: dark `ink-950/900/800` (zinc desaturato verso viola) + accento `accent-500` (#7c3aff violet elettrico) + cyan secondario per gradient. Aurora gradient soffuso animato come bg fisso globale.
- **Tipografia**: Inter (display + body), Instrument Serif disponibile per accenti, JetBrains Mono per ID/code. Heading con `letter-spacing: tighter2`. `text-gradient` per i titoli principali, `text-gradient-accent` per highlights.
- **Tokens Tailwind** (in `tailwind.config.js`): palette `ink.*` + `accent.*`, shadows `glow-sm/glow/glow-lg/card/card-hover`, animations `fade-in/rise/shimmer/aurora/pulse-glow`, backgroundImage `grid-dim/aurora-1/aurora-2`.
- **Componenti** (`src/components/`): `Logo` (SVG inline con gradient), `Avatar` (foto MelluCode + iniziali gradient deterministico come fallback), `StatusPill` (dot luminoso), `Skeleton` (shimmer animato), `EmptyState` (illustrazione SVG inline + microcopy + CTA), `PageBackground` (aurora animata fissa), `Toast` (provider + variants success/error/info).
- **Effetti**: `.glass` (backdrop-blur + bg/70%), `.surface-hover` (border accent + lift on hover), `:focus-visible` con doppio ring (ink-950 + accent-500/50), scrollbar custom brand-aware, selection color brand.
- **Animazioni**: page enter `animate-rise`, hero `animate-rise-slow`, skeleton `shimmer`, background `aurora` (14s ease-in-out), button hover translateY -1px.

Pagine dimostrate (tutte da considerare riferimento Fase 2):
- **LoginPage**: split layout lg, lato sx con hero + aurora + pill features, lato dx form con icon-prefix input + bottone CTA gradient + credenziali demo in fondo. Mobile: collassa a singola colonna.
- **MembersListPage**: header + bottone primary, **stats row** 4 card con icon + value tabular-nums + accent-tinted top-border, search input con icona, **skeleton** durante il primo load, **empty state** illustrato quando 0 membri, "no results" friendly per search vuota, grid responsive con card hover (border accent + lift).
- **MemberFormPage**: breadcrumb, hero title, 3 card sezioni (identita'+foto, abbonamento, note), avatar con overlay camera al hover per upload, sticky action bar in fondo con glass.
- **MemberDetailPage**: hero card con banner gradient + avatar ring, dati membro a sinistra + **panel AI a destra con gradient border glow**, output AI in box con accent ring + bottone copia.

Tutti gli stati edge curati: 401 mostra "Carico la sessione…" con icona pulse, errori in card rose con bordo colorato, AI 402 messaggio chiaro "Credito esaurito, contatta admin".

Stack che la demo prova: `mc.auth.login/me/logout`, `mc.data().list/get/create/update/delete`, `mc.files.upload/downloadBlob`, `mc.ai.chat` con gestione 402. Quota AI tenant a 0.1 credito sul server (sufficiente per centinaia di test).

Bundle finale: 218 KB / 68 KB gz, 1 file CSS 38 KB / 7 KB gz. Lucide-react tree-shaken (~10 KB di icone usate).

### Demo URL precedente (commit `caf901b`)
La versione precedente "minimal Tailwind funzionale" e' stata sovrascritta dal deploy premium. Non torna piu' indietro perche' i token Tailwind e i path components sono cambiati.

- Credenziali demo:
  - email: `admin@palestra-demo.it`
  - password: `Palestra2026!`
- Sorgente: `platform/templates/palestra/` (React + Vite + Tailwind, SDK importato via `file:../../sdk`).
- Backend: nessun endpoint custom. Auth → `mc.auth.login`. Lista/create/update/delete membri → `mc.data("members")`. Upload foto → `mc.files.upload` + `downloadBlob` (perche' il binario richiede bearer). AI → `mc.ai.chat` con gestione esplicita del `402` quando il credito e' esaurito.
- Tenant pre-seedato sul server (`mellucode_dev.mc_tenants.slug='palestra-demo'`):
  - creator owner: `demo-owner@mellucode.mellutecno.it` (password generata random, salvata solo nella sessione di seed)
  - app admin: `admin@palestra-demo.it` / `Palestra2026!` (mustChangePassword=false per la demo)
  - `publicRegistrationEnabled=false`
  - entity `members` con schema Ajv completo: required `name`, `format:email` su `email`, `enum` su `subscription_type`, `format:date` su `subscription_until`, `maxLength` su `notes`. Permessi: read/create authenticated, update owner_or_admin, delete admin.
  - quota AI: `mc_ai_quotas.monthly_limit_micros = 100000` (~0.1 credito; bastano qualche migliaio di chiamate gpt-4o-mini)
  - 3 membri di esempio: Mario Rossi (mensile in corso), Lucia Bianchi (annuale), Giulia Verdi (scaduto)
- Deploy:
  - static in `/opt/mellucode/demo/palestra/` (root:root, perms default)
  - nginx vhost esteso con `location /demo/palestra/` + `alias` + `try_files` per SPA + cache aggressiva su `/assets/`
  - backup vhost pre-modifica in `/opt/mellucode-backups/nginx/mellucode.mellutecno.it.before-demo.20260518-074920`
- Verifiche fatte (this session):
  - `GET /demo/palestra/` -> 200 HTML
  - `GET /demo/palestra/assets/index-*.js` -> 200 application/javascript
  - `POST /v1/app-auth/login` per palestra-demo -> 200 token
  - `GET /v1/data/members` -> 3 record pre-seedati

## Prossimo passo consigliato
1. **Aprire l'URL nel browser** e cliccare in giro: login, crea un membro nuovo con foto, prova "✨ Genera messaggio". Se qualcosa non funziona, l'iterazione di refinement va su `platform/templates/palestra/`.
2. **Decidere come il billing abilita/ricarica `mc_ai_quotas` per tenant** (oggi e' a 0 di default, qui per la demo abbiamo settato 100000 micros a mano). Un endpoint admin `/v1/admin/tenants/:id/ai-credits` sembrerebbe il prossimo blocco.
3. **Configurare eventuale lista esplicita `OPENROUTER_ALLOWED_MODELS`** se vogliamo limitare i modelli disponibili alle app generate (oggi solo `OPENROUTER_DEFAULT_MODEL` se non specificata).
4. **Build/distribuzione SDK** come UMD/CDN per consumo da `<script>` (oggi e' solo ESM via `file:` symlink); abilita Fase 2 orchestrator a iniettarlo nei template generati.
5. **Orchestrator Fase 2**: il template `palestra/` mostra la forma dei file generati. Prossimo: pipeline AI che da prompt utente → schema entita' + frontend basato su questo template scheletro.

## Note importanti
- Non toccare `/opt/lococode-legacy`.
- Non stampare `.env` o segreti in chat/log.
- La password DB e' comparsa in transcript precedenti: se Antonio vuole, ruotarla di nuovo.
- `npm audit` ha segnalato vulnerabilita' transitive: da affrontare in branch separato, non con `npm audit fix` diretto su questa linea.
