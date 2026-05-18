# HANDOFF MelluCode

## Aggiornamento Claude Code - 2026-05-18 sera (build async DEPLOYATA + smoke OK)

Pipeline asincrona schema→frontend con polling DEPLOYATA e VERIFICATA in produzione.
Commit deployati: `e164429` (backend) + Console dist `index-BhoB9VKA.js`.

### Cosa cambia per l'utente
- Cliccare "Costruisci app" non blocca piu' la pagina per 60+ secondi.
- La Console mostra avanzamento live: queued → schema → frontend → done con
  messaggi human-readable e progress bar.
- Se l'utente refresha durante la build, al ricaricamento la Console rileva
  automaticamente il build attivo e riprende il polling (vedi useEffect
  AppDetailPage che fa listBuilds(limit:1) al mount).
- Se l'utente clicca "Costruisci" mentre c'e' gia' un build attivo, riceve
  il build esistente e riprende il polling (no race, no doppio build).

### Smoke produzione (sessione corrente, OK 32 sec totali)
- Creator temporaneo, app "AsyncDemo" con prompt "parrucchiere clienti
  servizi appuntamenti" (settore non in catalogo, no bias).
- startBuild → 201 immediato, status=queued.
- 2o startBuild → 409 + stesso buildId (lock funziona).
- Polling 16 iterazioni 2s: stages osservati schema→frontend→done.
- /apps/async-{ts}/ → HTTP 200, contiene riferimento app.
- Cleanup OK (DB + cartella apps).

### Architettura deployata
- **DB**: nuova tabella `mc_app_builds` (migration 0006, applicata al boot)
  con status (queued/running/succeeded/failed), stage, progress, messages
  jsonb push-only, options, errorMessage/errorDetails, timestamps.
- **Worker**: `platform/api/src/orchestrator/buildRunner.js`
  - `enqueueBuild` controlla lock (no doppio attivo per tenant), insert row
    queued, lancia `runBuild(buildId)` con setImmediate (fire-and-forget).
  - `runBuild` aggiorna stato in DB man mano, esegue schema (via
    `runSchemaGeneration` estratto) poi frontend (via `buildGeneratedFrontend`
    esistente). Su crash imprevisto -> markFailed best-effort.
- **Endpoint** (in `routes/tenants.js`):
  - POST /v1/tenants/:id/builds -> enqueue (201 nuovo / 409 conflitto)
  - GET  /v1/tenants/:id/builds/:bid -> polling
  - GET  /v1/tenants/:id/builds?limit=20 -> storia
- **Console** (in `pages/AppDetailPage.jsx`):
  - `handleBuildApp` → `startBuild` → `startPolling` ogni 2s
  - `useEffect` al mount riprende polling se c'e' build attivo
  - `useEffect` cleanup stop polling su unmount/cambio tenant
  - `applyBuildSnapshot` aggiorna stage/progress/messages dal server
- **Backward-compat**: route sincrone `/generate-schema` e `/generate-frontend`
  restano funzionanti. `/generate-schema` ora delega a `runSchemaGeneration`
  (DRY: stessa funzione del worker).

### Caveat noti / da migliorare in futuro
- **Build orfani**: se il process Node muore mid-build, la row resta
  status=running per sempre. Serve sweep periodico che marchi failed dopo
  N minuti senza heartbeat. Per ora: PM2 restart manuale + UPDATE manuale.
- **Concorrenza**: il lock e' best-effort (race possibile fra select e
  insert). Se diventa problema, advisory lock Postgres.
- **Cancellazione build**: non implementata (DELETE /builds/:bid). Per ora
  l'utente deve aspettare succeeded/failed.
- **Streaming live (SSE)**: polling 2s funziona ma per UX sub-secondo
  servirebbe Server-Sent Events. Non urgente.

### Prossimi step consigliati
1. **Chat modifiche** (UX Lovable vero): bottone "Chiedi una modifica"
   apre un input chat, l'utente scrive "aggiungi campo email ai clienti",
   il backend interpreta, ri-genera schema/frontend via build async.
2. **Cancellazione build**: DELETE /v1/tenants/:id/builds/:bid + sweeper
   per orfani.
3. **Storia builds in Console**: card "Build precedenti" con click per
   vedere log/errori dei build passati.
4. **Mobile QA reale** (gia' consigliato da Codex).

---

## Aggiornamento Claude Code - 2026-05-18 sera (piano build async + polling)

Riprendo dopo Codex (`8c5c5dd`). Stato verificato:
- Server: deployato `8c5c5dd`, `/v1/health` OK
- Locale: pulito, solo `deploy.py` untracked (credenziali — non committare)
- 129/130 test pass (1 integration skip)

**Prossimo step**: trasformare la pipeline guidata (oggi sincrona) in **job
asincrono con polling**, cosi' la Console non blocca per 60+ secondi durante
`npm install + vite build` e mostra avanzamento live tipo Lovable.

### Piano sotto-step (committo dopo ognuno)

1. **DB + schema**: nuova tabella `mc_app_builds`:
   - id uuid pk, tenantId fk cascade, status (queued|running|succeeded|failed)
   - stage (queued|schema|frontend|done)
   - progress int 0-100
   - messages jsonb array (testi human readable in sequenza)
   - errorMessage text null, startedAt, finishedAt, createdAt
   - index su (tenant_id, created_at desc)
   - migration drizzle 0006_*

2. **buildRunner.js** in `platform/api/src/orchestrator/`:
   - `enqueueBuild(tenant, { skipSchema })` → insert row queued, lancia `runBuild(buildId)` con `setImmediate` (no await dal caller), ritorna buildId
   - `runBuild(buildId)` worker:
     - load tenant + entities
     - update status=running, stage=schema, push message
     - se !skipSchema o no entities: chiama logica esistente di `generate-schema` (estraggo helper riusabile da routes/tenants.js)
     - update stage=frontend, push message
     - chiama `frontendBuilder.buildFrontend()` esistente
     - update status=succeeded, stage=done, push message finale
     - su errore: update status=failed, errorMessage, finishedAt
   - Lock leggero: se gia' un build running per tenant → enqueueBuild ritorna 409

3. **3 endpoint** in `routes/tenants.js`:
   - `POST /v1/tenants/:id/builds` body `{ skipSchema? }` → 201 `{ buildId, status }` (creator-owner)
   - `GET /v1/tenants/:id/builds/:buildId` → ritorna stato corrente per polling (creator-owner)
   - `GET /v1/tenants/:id/builds?limit=20` → lista storia builds (creator-owner)

4. **Console polling + UI live**:
   - `lib/api.js`: `tenants.startBuild`, `tenants.getBuild`, `tenants.listBuilds`
   - `AppDetailPage.jsx`: rimpiazza `handleBuildApp` esistente (chiamate seriali blocking) con startBuild → polling 2s su getBuild → mostra stages live + messages stream → iframe preview quando done
   - Mantiene il flusso `?build=1` da AppsDashboardPage post-create (auto-start)
   - Stop polling su unmount/cleanup

5. **Test + deploy + smoke**:
   - Unit per `enqueueBuild` (lock, status iniziale), `runBuild` mock
   - Integration per i 3 endpoint
   - Deploy server, restart pm2
   - Smoke: tenant temporaneo, startBuild, poll fino succeeded, verifica `/apps/SLUG/` HTTP 200, cleanup

### Cosa NON entra in questo giro
- Cancellazione build in corso (manca PATCH/DELETE) — futuro
- Notifiche email/webhook su build done/failed — futuro
- Build queue distribuita (Redis/Bull) — overkill per ora, `setImmediate` in process basta
- Streaming server-sent events — polling 2s e' sufficiente, SSE solo se UX richiede sub-secondo

### Vincoli
- Non rompere il flusso esistente: vecchie route `generate-schema` e `generate-frontend` restano per backward-compat
- HANDOFF aggiornato a ogni sotto-step completato

---

## Aggiornamento Codex - 2026-05-18 (Flusso Lovable-style + preview)

Stato dopo questo giro:
- Branch: `mellucode-v2`
- Obiettivo: avvicinare la Console a un flusso tipo Lovable, riducendo i passaggi tecnici visibili e mostrando preview/stato costruzione.
- File sensibile non tracciato: `deploy.py` resta fuori dal commit.

### Fatto
- Console:
  - dopo `Nuova app`, l'utente viene portato direttamente al dettaglio app con query `?build=1`;
  - il dettaglio app avvia automaticamente la pipeline `generate-schema -> generate-frontend`;
  - aggiunta sezione **Costruzione app** con 3 step leggibili: struttura, interfaccia, preview;
  - aggiunti messaggi umani di avanzamento, senza log tecnici;
  - aggiunta sezione **Preview** con iframe della web app generata appena disponibile;
  - il pulsante principale diventa `Costruisci app` / `Aggiorna app`;
  - i comandi manuali restano sotto come controlli tecnici: `Rigenera struttura` e `Rigenera frontend`;
  - la modale `Modifica app` ora permette anche di modificare la richiesta iniziale (`initialPrompt`);
  - topbar resa piu' responsive: la navigazione non sparisce piu' sotto `md`, quindi la voce `Admin` resta accessibile anche su smartphone.
- Backend:
  - `PATCH /v1/tenants/:id` accetta anche `initialPrompt`;
  - se si cambia slug, il frontend pubblicato precedente viene invalidato e la cartella generata del vecchio slug viene rimossa best-effort.

### Verifiche
- `npm test` in `platform/api`: PASS (129 pass, 1 integration skip).
- `npm run build` in `platform/console`: PASS.

### Prossimo passo consigliato
1. Rendere la pipeline non bloccante con job server + polling stato, cosi' la pagina non resta appesa su chiamate lunghe.
2. Migliorare la modifica app: campo "chiedi una modifica" stile chat, che aggiorna prompt/schema/frontend senza passare da textarea tecnica.
3. Mobile QA reale: verificare topbar, modali e preview iframe da viewport smartphone.

---

## Aggiornamento Codex - 2026-05-18 (Frontend builder Lovable-style)

Stato dopo questo giro:
- Branch: `mellucode-v2`
- Obiettivo: trasformare lo Step 3a in una pipeline concreta **template + personalizzazione**, cioe' generare un frontend vero da `_base` e pubblicarlo sotto `/apps/{slug}/`.
- File sensibile non tracciato: `deploy.py` resta fuori dal commit perche' contiene credenziali in chiaro.

### Fatto
- Backend:
  - aggiunta config `generatedApps` (`GENERATED_APP_TEMPLATE_DIR`, `GENERATED_APPS_DIR`, `GENERATED_APP_BUILD_ROOT`, `MELLUCODE_SDK_DIR`, `GENERATED_APP_BUILD_TIMEOUT_MS`);
  - aggiunto `platform/api/src/orchestrator/frontendBuilder.js`;
  - il builder copia `platform/templates/_base`, sostituisce token app/tenant/theme/entity, installa dipendenze, esegue `npm run build`, pubblica `dist` in `apps/{slug}`;
  - dipendenza `mellucode-sdk` del template riscritta verso il path reale del repo, cosi' funziona sia in locale sia sul server;
  - aggiunto `POST /v1/tenants/:id/generate-frontend`, protetto dal creator owner del tenant;
  - quando si elimina un tenant, viene eliminata anche la cartella frontend generata per quello slug.
- Console:
  - aggiunto client `tenants.generateFrontend(id)`;
  - nella pagina dettaglio app aggiunta sezione **Frontend app** con bottone `Genera frontend` / `Rigenera frontend` e link `Apri frontend`;
  - dopo `generate-schema` la Console ricarica il tenant aggiornato, cosi' metadata theme/schema resta allineato.
- Test:
  - aggiunti test unit per `pickPrimaryEntity`, `buildTemplateReplacements`, `applyTemplateTokens`;
  - prova reale locale del builder: generata e compilata app temporanea `test-builder-local` con theme `dark-cyan`, build riuscita;
  - smoke produzione iniziale ha rilevato che con `NODE_ENV=production` npm ometteva le devDependencies, quindi mancava `vite`; fixato install builder con `npm install --include=dev`;
  - smoke produzione finale: creato tenant temporaneo, inserita entity `contacts`, chiamato `POST /v1/tenants/:id/generate-frontend`, pubblicata app su `/apps/smoke-frontend-.../`, verifica HTTP 200, cleanup tenant + cartella generata riuscito;
  - `npm test` API: PASS (129 pass, 1 integration skip);
  - `npm run build` Console: PASS.

### Note operative server
- In produzione il default del builder diventa:
  - repo root: `/opt/mellucode`;
  - template: `/opt/mellucode/platform/templates/_base`;
  - SDK: `/opt/mellucode/platform/sdk`;
  - output app: `/opt/mellucode/apps/{slug}/`.
- Nginx deve avere una location `/apps/{slug}/` che serve staticamente `/opt/mellucode/apps/{slug}/` con fallback SPA su `index.html`.
- Produzione aggiornata: nginx `mellucode.mellutecno.it` contiene gia' le location `/apps/{slug}/assets/` e `/apps/{slug}/`.

### Prossimo passo consigliato
1. Deploy e test reale su un tenant con schema gia' generato.
2. Migliorare UX della Console: dopo `Genera schema` proporre direttamente `Genera frontend`.
3. Step successivo Lovable-style: job orchestrator che concatena automaticamente `schema -> frontend -> link finale`, senza far cliccare manualmente ogni pezzo.

---

## Aggiornamento Codex - 2026-05-18 (Area Admin piattaforma)

Stato dopo questo giro:
- Branch: `mellucode-v2`
- Obiettivo: aggiungere una vera **area amministratore MelluCode** separata dagli utenti creator normali.
- Admin previsto da Antonio: `mellucciantonio@gmail.com`.
- File sensibile non tracciato: `deploy.py` resta fuori dal commit perche' contiene credenziali in chiaro.

### Fatto
- Backend:
  - aggiunta config `ADMIN_EMAILS` con fallback `mellucciantonio@gmail.com`;
  - aggiunto helper `platform/api/src/utils/platformAdmin.js`;
  - registrazione/login/refresh/me promuovono automaticamente a `role="admin"` le email presenti in `ADMIN_EMAILS`;
  - aggiunta route `platform/api/src/routes/admin.js` sotto `/v1/admin/*`;
  - registrata route admin in `platform/api/src/app.js`.
- Endpoint admin implementati:
  - `GET /v1/admin/users` — lista utenti creator MelluCode con conteggio app;
  - `DELETE /v1/admin/users/:id` — elimina utente e tutte le sue app/tenant, bloccando l'eliminazione del proprio account admin;
  - `POST /v1/admin/users/:id/email` — invia email all'indirizzo con cui l'utente si e' registrato, usando SMTP server;
  - `GET /v1/admin/tenants` — lista globale di tutte le app con owner;
  - `DELETE /v1/admin/tenants/:id` — elimina una qualsiasi app e prova a rimuovere anche i file su disco.
- Console:
  - aggiunta pagina `platform/console/src/pages/AdminPage.jsx`;
  - aggiunta voce `Admin` in topbar visibile solo se `user.role === "admin"`;
  - aggiunto client `admin` in `platform/console/src/lib/api.js`;
  - la pagina admin mostra utenti, app, ricerca, invio email, eliminazione utenti/app.
- Test:
  - aggiunti test integration per `/v1/admin` (girano solo con `TEST_DATABASE_URL`);
  - `npm test` API senza DB: PASS (integration skip come previsto);
  - `npm run build` Console: PASS.

### Note operative
- In produzione va garantito in `.env`:
  - `ADMIN_EMAILS=mellucciantonio@gmail.com`
- Se l'utente admin esiste gia', dopo deploy si puo' promuovere con:
  - `UPDATE mc_users SET role='admin', updated_at=now() WHERE email='mellucciantonio@gmail.com';`
- L'admin Console e' un MVP tecnico: non ha ancora filtri avanzati, paginazione UI, template email o storico comunicazioni dedicato. Le azioni vengono comunque protette e audit-loggate lato API.

### Prossimo passo consigliato
Riprendere la pipeline Lovable-style:
1. `platform/api/src/orchestrator/frontendBuilder.js`
2. `POST /v1/tenants/:id/generate-frontend`
3. pubblicazione in `/opt/mellucode/apps/{slug}/`
4. bottone Console "Genera frontend" / "Apri app".

---

## Aggiornamento Codex - 2026-05-18 (Sotto-step 2 completato + Console modal hardening)

Stato dopo questo giro:
- Branch: `mellucode-v2`
- Obiettivo accettato: Step 3 = **template + personalizzazione AI**, niente codegen React puro.
- File sensibile non tracciato: `deploy.py` resta fuori dal commit perche' contiene credenziali in chiaro.

### Fatto
- Completato `platform/templates/_base/` con pagine generiche vere:
  - `src/pages/EntityListPage.jsx`
  - `src/pages/EntityFormPage.jsx`
  - `src/pages/EntityDetailPage.jsx`
- Il template legge lo schema dinamicamente da `mc.entities.list()`, sceglie la primary entity e renderizza lista, dettaglio, creazione, modifica, eliminazione record, upload file e campi dinamici.
- `platform/templates/_base/README.md` riscritto: non parla piu' di palestra demo, ma di template parametrico.
- `platform/templates/_base/src/index.css` ora usa token tema anche per aurora, selection, focus e glow; meno bias viola/palestra.
- Console:
  - `Modal.jsx` reso piu' robusto: portal su body, dialog con `max-height: 100dvh`, body interno scrollabile, overlay sopra tutto. Serve per popup nuova app / modifica / elimina.
  - Copy utente piu' umano in dashboard, modifica app e zona eliminazione.

### Verifiche fatte
- `npm run build` in `platform/console`: PASS.
- Smoke template: copia temporanea di `_base`, sostituzione token dummy + palette `dark-electric`, `npm install`, `npm run build`: PASS.
- Smoke produzione cancellazione app:
  - registrato creator temporaneo;
  - creato tenant temporaneo;
  - chiamato `DELETE /v1/tenants/:id`;
  - verificato con `GET /v1/tenants` che il tenant non comparisse piu'.
  - Risultato: PASS.
- Test reale richiesto da Antonio:
  - eliminata l'app `Palestra` (`slug=palestra`, owner `mellutecno@gmail.com`) usando la route API `DELETE /v1/tenants/:id` tramite `app.inject` sul server;
  - risposta delete: `204`;
  - count tenant per quell'account: prima `1`, dopo `0`;
  - quindi la cancellazione backend funziona davvero. Il bug visto in UI era nella modale/popup, non nella route delete.

### Prossimo passo
Sotto-step 3: implementare `platform/api/src/orchestrator/frontendBuilder.js`, cioe' il builder server-side che copia `_base`, sostituisce token, esegue build e pubblica l'app in `/opt/mellucode/apps/{slug}/`.

---

## Aggiornamento Claude Code — 2026-05-18 notte (Inizio Step 3a — pipeline template-based)

Sto per partire con **Step 3a**: pipeline template-based per la generazione frontend delle app. Approccio Lovable-like: template parametrico fisso + token substitution + AI personalizza solo le sostituzioni (palette, nome app, label primarie). Niente codegen puro di file React da zero.

### Piano Step 3a (sotto-step da committare separatamente)

Per ogni sotto-step: codice + test locali + commit + push. Deploy server e nginx solo nei sotto-step che lo richiedono.

1. **Theme palette mapping** — `platform/api/src/orchestrator/themePalettes.js`
   - Per ognuno dei 7 temi (`dark-electric`, `warm-amber`, `light-modern`, `navy-trust`, `editorial-rose`, `dark-cyan`, `sage-wellness`): definire i valori Tailwind reali — `ink` scale 100/200/.../950, `accent` scale 50/100/.../900, shadow `glow-sm/glow/glow-lg`, gradients di sfondo, eventuali font hint (es. serif per editorial-rose).
   - Helper `themePalette(id)` ritorna l'oggetto completo, `themeTailwindConfig(id)` ritorna una stringa di config Tailwind sostituibile nel template.
   - Test unit: ogni tema esporta tutte le scale richieste, helpers ritornano valori.

2. **Template parametrico** — `platform/templates/_base/`
   - Fork di `platform/templates/palestra/` con i punti che variano TOKENIZZATI:
     - `__APP_NAME__` (es. "Palestra Demo", "Gelateria Mario")
     - `__APP_SUBTITLE__` (es. "Membri e abbonamenti", "Gusti e fornitori")
     - `__TENANT_SLUG__` (es. "palestra-demo")
     - `__BASE_PATH__` (es. "/apps/palestra-demo/")
     - `__PRIMARY_ENTITY_NAME__` + `__PRIMARY_ENTITY_LABEL__` (snake_case + label)
     - palette tokens: tutto in `tailwind.config.js` rimpiazzabile via stringa
   - Test del template "as-is" con valori dummy: build deve passare.
   - Niente entita' hardcoded come "members" — tutto generico, pagine "list/detail/form" della primary entity.

3. **Builder server-side** — `platform/api/src/orchestrator/frontendBuilder.js`
   - Input: `{ tenant, entities, theme, paths }`.
   - Pipeline: copia `_base/` in `/tmp/build-{tenantId}-{ts}/` → sostituisci tutti i token nei file (con whitelist estensioni) → `npm install --production --silent` → `vite build` → copia `dist/*` in `/opt/mellucode/apps/{slug}/` → cleanup tmpdir.
   - Gestione errori: se `npm install` o `vite build` falliscono, propagare errore strutturato + log su `mc_app_files` come "build_log" o tabella nuova.
   - Test: con un template `_base/` valido e tenant fake, builder genera dist in target dir.

4. **Endpoint** `POST /v1/tenants/:id/generate-frontend`
   - Auth: creator-owner del tenant (come generate-schema).
   - Verifica che ci siano entita' (`mc_app_entities` count > 0). Se no, 400 "Genera prima lo schema".
   - Chiama frontendBuilder. Sincrono inline per MVP (per build veloci <60s). Async + job queue se diventa lento.
   - Response: `{ url: "/apps/<slug>/", buildMs, theme, primaryEntity }`.
   - Update `tenant.metadata.frontendDeployedAt`.

5. **Nginx** — aggiungi location dinamica
   - `location ~ ^/apps/([a-z0-9-]+)/ { alias /opt/mellucode/apps/$1/; try_files $uri $uri/ /apps/$1/index.html; }`
   - `location ~ ^/apps/([a-z0-9-]+)/assets/` con cache 1y.
   - Backup vhost pre-modifica come al solito.

6. **Console** — bottone "Genera frontend" + link
   - In `AppDetailPage.jsx` aggiungere card "Frontend" dopo "Schema AI" che mostra:
     - Se non generato: bottone "Genera frontend" che chiama l'endpoint, mostra loading durante il build (~30-60s).
     - Se generato: link "Apri l'app" verso `/apps/{slug}/` + bottone "Rigenera".
   - `lib/api.js`: aggiungere `tenants.generateFrontend(id)`.

### Cosa NON entra in Step 3a (rimandato a Step 3b)
- Codegen AI di componenti React custom oltre al template
- Edit "in-place" delle app generate (Fase 3 architecture)
- Multi-template selection (per ora UN template `_base/` per tutti)
- Deploy con SSL custom domain per app

### Vincoli da rispettare
- Qualita' premium UI (regola memoria): il template `_base/` parte dal palestra refactor premium, NON regredire.
- Backend MelluCode invariato — l'app generata usa solo `mc.*` SDK come il palestra demo.
- Storage isolato per tenant (gia' funzionante via `mc_app_files`).

### Stato corrente
- Backend Fase 1: completo (auth/tenants/data/files/email/ai).
- Orchestrator Step 1+2: completo (catalogo settori + smart prompt + theme).
- Bias palestra: fixato (commit `7a115be`).
- Manca: Step 3a (questo), Step 3b (codegen avanzato), billing tenants.

### Avanzamento sotto-step (aggiornato a ogni commit)

- [x] **Sotto-step 1 — Theme palette mapping** (commit `9ac191b`)
  - `platform/api/src/orchestrator/themePalettes.js` — 7 palette complete (ink 50..950, accent 50..900, glow sm/md/lg + card/card-hover, bg aurora, font, selection). Helper `themePalette()`, `themePaletteWithFallback()`, `themeReplaceMap()` per token replace.
  - 13 test PASS, hex valid check, fallback check, coverage check.
- [ ] **Sotto-step 2 — Template parametrico `platform/templates/_base/`** (IN PROGRESS)
  - 2a: fork da `palestra/` + rimozione file specifici (Avatar, StatusPill, Members*Page) + tokenizzazione (`tailwind.config.js`, `index.html`, `vite.config.js`, `src/main.jsx`, `src/lib/api.js`, `src/App.jsx`).
  - 2b: `src/lib/entityIntrospect.js` (analyze schema -> primary/photo/status/date fields) + `src/components/FieldRenderer.jsx` (input + display dinamico per ogni tipo) + pagine generiche EntityListPage, EntityFormPage, EntityDetailPage che leggono lo schema dinamicamente via `mc.entities.list()`.
  - 2c: smoke build con valori dummy fissi (sostituisco tokens via sed/script -> `npm run build` deve passare).
  - **Convenzione tokens**: `__TOKEN_NAME__` (es. `__APP_NAME__`, `__TENANT_SLUG__`, `__PRIMARY_ENTITY_NAME__`, `__BASE_PATH__`, `__THEME_INK_950__`, `__THEME_ACCENT_500__`, ecc.). Sostituzione via regex `/__[A-Z_]+__/g` -> map.
  - **Field auto-render heuristics**:
    - `primary field` = primo `required` di tipo string, fallback `name|title|label`
    - `photo field` = primo `*_file_id`
    - `status field` = primo `enum`
    - `date field` = primo `format=date|date-time`
    - resto = field generici
- [ ] Sotto-step 3 — frontendBuilder server module
- [ ] Sotto-step 4 — endpoint `POST /v1/tenants/:id/generate-frontend`
- [ ] Sotto-step 5 — nginx location dinamica `/apps/SLUG/`
- [ ] Sotto-step 6 — Console card Frontend + bottoni

---

## Aggiornamento Claude Code — 2026-05-18 notte (Fix bias palestra)

Commit: `7a115be` Fix orchestrator bias verso palestra: keyword cleanup + threshold + stem IT.

### Bug fixato
Antonio ha notato che ogni nuova app generata finiva con lo schema palestra come riferimento, anche quando il prompt era completamente diverso. Causa: `inferSector` matchava troppo facilmente (keyword troppo trasversali come "corsi", "abbonamento", "sport", "clienti", "ordini", "prenotazione") -> sectorHintBlock proponeva palestra all'AI -> l'AI seguiva il template.

### Tre fix combinati
1. **Keyword cleanup** in tutti i 6 settori: solo parole settore-specifiche. Vedi commit message per il dettaglio per settore. Le parole trasversali sono state rimosse; quelle composte (es. "personal trainer", "studio legale", "case study") sono state preservate perche' inequivoche.
2. **Threshold + stem IT** in `inferSector`: ora normalizza con uno stem italiano basico (rimuove flessione sing/plur tipo "pazienti"->"pazient") e richiede score >= 3 per ritornare un settore. Sotto soglia: null (l'orchestrator genera senza sector hint).
3. **sectorHintBlock indebolito**: non mostra piu' lo schema completo del settore (con i field) ma solo i nomi delle entita'. Aggiunge regole esplicite di priorita': "il PROMPT UTENTE e' la fonte di verita', il riferimento e' solo orientamento".

### Smoke OpenRouter reale dopo deploy
Testati 5 prompt "anti-bias" che PRIMA finivano in palestra:

| Prompt | sector | theme | entita' generate |
|---|---|---|---|
| Gelateria artigianale | `null` | warm-amber | gelato_flavors, suppliers |
| Parrucchiere con prenotazione | `null` | warm-amber | class_services, class_bookings, class_customers |
| Scuola di musica con corsi | `null` | warm-amber | class_corsi, class_allievi, class_insegnanti |
| Club lettura con abbonamenti | `null` | editorial-rose | club_lettura, abbonamenti, utenti |
| Officina meccanica | `null` | dark-electric | vehicle, repair, spare_part |

Tutti FUORI dal catalogo settori -> nessun bias palestra applicato. L'AI ha scelto autonomamente entita' coerenti col business reale e theme dalla lista chiusa.

### Test
- 114 totali (113 PASS + 1 integration skip)
- 5 nuovi casi anti-bias (scuola di musica, club lettura, CRM commerciale, parrucchiere, fotografo matrimoni)
- `inferSectorWithScore` aggiunto per debug della soglia

### Nota su settori non in catalogo
Quando l'AI non riceve sector hint (perche' il prompt non matcha nulla con score >= 3), genera comunque uno schema decente perche' il system prompt include comunque:
- design brief
- lista 7 temi
- catalogo settori (solo come riferimento di vibe, non come schema)

L'AI sceglie autonomamente un theme dalla lista chiusa. Quindi anche per "gelateria" o "officina" — settori non in catalogo — la qualita' resta alta.

---

## Aggiornamento Claude Code — 2026-05-18 sera (Step 1 + Step 2 orchestrator)

Stato attuale verificato:
- branch: `mellucode-v2`
- ultimo commit locale/remoto/server: `818a343` Step 2 orchestrator
- commit precedente: `01a1b9d` Step 1 sector catalog + themes
- **Deploy server completato** (pm2 restart OK, health OK)
- **Smoke OpenRouter reale** OK su 4 settori diversi (vedi sotto)

### Cosa e' stato fatto

**Step 1 — Catalogo settori + temi visivi** (`01a1b9d`)

Nuovo modulo `platform/api/src/orchestrator/`:
- `themes.js` — 7 temi chiusi: `dark-electric, warm-amber, light-modern, navy-trust, editorial-rose, dark-cyan, sage-wellness`. Ogni tema ha id + vibe + esempi. Lista FROZEN: l'AI non puo' inventarne altri.
- `sectors/_index.js` — registry + `getSector`, `listSectors`, `sectorsPromptList`, `inferSector(prompt)` deterministica (keyword soft con score pesato per significativita').
- `sectors/{palestra,ristorante,negozio,studio-professionale,eventi,portfolio}.js` — 6 settori con 3-4 entita' core ognuno. Ogni entita' passa `validateEntityDef`. Theme hint per settore. Label italiani naturali, campi snake_case sensati (es. `subscription_until`, `photo_file_id`, `total_cents`).
- `sectors.test.js` — 18 test: registry valido, ogni entita' di ogni settore passa la validation, inferenza keyword robusta, temi tutti validi.

**Step 2 — Orchestrator smart** (`818a343`)

`platform/api/src/utils/orchestrator.js`:
- `buildSystemPrompt(context)` sostituisce la versione rigida. Ora include opzionalmente:
  - `DESIGN_BRIEF_SHORT` distillato dal `docs/orchestrator-design-quality.md` (label naturali italiane, campi `*_file_id`/cover, enum status, niente `created_at/updated_at`, qualita' visiva = parte del valore).
  - `THEMES_BLOCK` (lista 7 temi con vibe + esempi).
  - `SECTORS_BLOCK` (catalogo settori come few-shot light: id + label + theme + sample keywords).
  - `sectorHintBlock(sector)` quando il settore e' inferito: blocco "SETTORE INFERITO" con le prime 3 entita' del settore come ispirazione, non da copiare letteralmente.
  - Default `buildSystemPrompt()` resta backwards-compatible (test storici passano).
- `validateEntityDef` ora valida `metadata.theme` contro `THEME_IDS`. Theme vuoto/null tollerato. Invalid -> errore esplicito.
- Nuova `pickThemeFromEntities(entities, fallback)`: pesca il primo theme valido dalle entita'.

`platform/api/src/routes/tenants.js` route `POST /:id/generate-schema`:
- **Pre-call**: `inferSector(prompt)` deterministica (keyword soft, no AI). Risultato passato come contesto a `buildSystemPrompt({sector})`.
- **Post-call**: theme finale = `pickThemeFromEntities` ?? `sector.theme` ?? `"dark-electric"`.
- **Update tenant.metadata**: `{...initialPrompt, sector, theme, schemaGeneratedAt}` (preserva i campi pre-esistenti).
- **Response include** `{entities, created, sector, theme, errors}` cosi' la Console mostra anche settore/tema scelto.

Tests:
- `src/test/orchestrator.test.js` esteso: buildSystemPrompt(context) coverage (designBrief opt-out, themes opt-out, includeCatalog opt-out, sector hint inietta entita' di riferimento), pickThemeFromEntities 4 casi, metadata.theme accept/reject/null.
- Locale: **107/107 PASS** (1 integration skip).

### Smoke OpenRouter reale (deploy `818a343` su server)

Eseguiti 4 case su gpt-4o-mini con prompt utente diversi:
| Prompt | sector inferito | theme | created | entita' |
|---|---|---|---|---|
| "Pizzeria napoletana, voglio gestire menu, prenotazioni e tavoli" | `ristorante` | `warm-amber` | 3 | menu_items, tables, reservations |
| "Studio legale: gestione clienti, pratiche e appuntamenti con fatture" | `studio-professionale` | `navy-trust` | 4 | clients, cases, appointments, invoices |
| "E-commerce di abbigliamento: prodotti, categorie, ordini, clienti" | `negozio` | `light-modern` | 4 | products, categories, customers, orders |
| "Portfolio di designer freelance con case study, testimonianze e contatti" | `portfolio` | `dark-cyan` | 3 | projects, testimonials, contacts |

L'AI usa davvero gli schemi di riferimento — i nomi entita' sono identici o quasi a quelli del catalogo. Inoltre piazza i theme corretti nel `tenant.metadata`. Smoke creators sono stati cancellati a fine corsa.

### Prossimo passo (Step 3a — pipeline template-based per il frontend)

Approccio "Lovable-like": template fisso + token substitution + AI personalizza solo le sostituzioni (nome, palette, label, copy). Niente codegen puro di file React da zero — la qualita' UI viene dal template, l'AI fa solo personalizzazione vincolata. Vedi conversazione precedente per il razionale.

Cosa serve in Step 3a:
- Template generico parametrico (forkare `platform/templates/palestra` come base + tokenizzare i punti che variano).
- Mapping `theme id → tailwind tokens` (ink + accent + glow + bg gradients).
- Job server che: legge tenant + entita' + theme, forka template, sostituisce tokens, `npm install + npm run build`, copia in `/opt/mellucode/apps/{slug}/`, aggiorna nginx (location `/apps/{slug}/`).
- Endpoint `POST /v1/tenants/:id/generate-frontend` (con coda async se serve, ma per MVP sincrono inline).
- Console: bottone "Genera frontend" dopo aver generato lo schema.

---

## Aggiornamento Claude Code - 2026-05-18 pomeriggio

Stato attuale verificato:
- branch: `mellucode-v2`
- ultimo commit locale/remoto/server: `74c210e` Fix Console generateSchema: send empty object body to avoid Fastify 400
- commit deployato server precedente: `0883cd5`
- **Deploy su server completato con successo**

Modifiche fatte (Fase 2 — Step 0: Schema Generation):
- **Nuovo endpoint API**: `POST /v1/tenants/:id/generate-schema`
  - Legge `tenant.metadata.initialPrompt` (o `promptOverride` opzionale nel body)
  - Chiama OpenRouter con system prompt rigido che forza output JSON array di entità
  - Estrae, valida e inserisce entità in `mc_app_entities` per il tenant (upsert per nome)
  - Auth: solo creator-owner dell'app; 404 se non owner; 400 se nessun prompt; 502 se AI non risponde JSON valido
- **Utilities nuove**:
  - `platform/api/src/utils/orchestrator.js` — `buildSystemPrompt()`, `extractJsonArray()`, `validateEntityDef()`
  - `platform/api/src/utils/entities.js` — `publicEntity()` condiviso tra `data.js` e `tenants.js`
  - `platform/api/src/utils/normalize.js` — `normalizeEntityName()` estratto da `data.js`
- **Config aggiornata**: blocco `orchestrator` con `ORCHESTRATOR_MODEL`, `ORCHESTRATOR_MAX_TOKENS`, `ORCHESTRATOR_MAX_ENTITIES`
- **Mock AI per test**: `OPENROUTER_MOCK_SCHEMA_RESPONSE` in `openRouterClient.js` per forzare risposta JSON nei test
- **Test**:
  - Unit test `platform/api/src/test/orchestrator.test.js`: 19/19 PASS
  - Integration test in `integration.test.js`: 4 nuovi test per generate-schema (happy path, no prompt, non-owner, invalid AI response)
  - Suite completa locale: **77/77 PASS** (1 integration skip senza TEST_DATABASE_URL)
- **Console UI aggiornata**:
  - `platform/console/src/pages/AppDetailPage.jsx`: nuova card "Schema AI" con bottone "Genera schema"
  - Mostra `initialPrompt` del tenant
  - Lista entità generate dopo il click
  - Refresh automatico delle stats per aggiornare conteggio "Tabelle dati"
  - `platform/console/src/lib/api.js`: aggiunto `tenants.generateSchema(id)`
  - Build Console produzione: OK (222 KB js / 68 KB gz, 38 KB css / 7 KB gz)

Deploy server eseguito:
- `git pull origin mellucode-v2` su `/opt/mellucode` → fast-forward a `74c210e`
- `npm install` + `pm2 restart mellucode-api` su `platform/api` → online (PID 967924)
- `npm install` + `npm run build` su `platform/console` → OK
- `cp -r platform/console/dist/* /opt/mellucode/console/` → dist deployata

Fix post-deploy:
- **Demo palestra 500**: directory `/opt/mellucode/demo/palestra/` mancante → nginx ciclo di redirect. Fix: copiati i file da `platform/templates/palestra/dist/` e reload nginx. Stato: HTTP 200 OK
- **Console "Genera schema" 400**: il frontend mandava una POST senza body; Fastify con `schema: { body: { type: "object" } }` rifiutava con 400. Fix: `api.js` ora invia `body: {}`. Commit `74c210e` deployato

Flusso utente attuale (cosa funziona oggi):
- Un creator può registrarsi, fare login, cliccare "Nuova app" e creare un tenant compilando nome, slug e descrizione iniziale (`initialPrompt`).
- Dalla dashboard può aprire il dettaglio dell'app e cliccare "Genera schema": l'AI legge `initialPrompt`, genera le entità (tabelle dati) e le salva in `mc_app_entities`.
- L'app generata ha quindi un backend dati funzionante (auth, Data API, file storage, AI proxy), ma **non ha ancora un frontend visibile**: manca lo Step 1 della Fase 2 (scaffolding frontend da template).
- L'unica app completa e navigabile resta `palestra-demo` su `/demo/palestra/` (hardcoded, costruita manualmente sullo stack MelluCode).

Prossimo passo consigliato:
1. Verificare da browser: aprire app detail, cliccare "Genera schema", controllare che le entità compaiano e che `GET /v1/data/entities` (con app-user admin) le mostri
2. Iniziare Step 1 della Fase 2: scaffolding frontend da template palestra + build + deploy su `/apps/{slug}/`

## Aggiornamento Codex - 2026-05-18 mattina

Stato attuale verificato:
- branch locale/remoto/server: `mellucode-v2`
- ultimo commit deployato server: `0883cd5` Fix Console modals and require app prompt
- commit precedente deployato: `5818aff` Add app lifecycle actions and humanize Console copy
- Console root online: `https://mellucode.mellutecno.it/`
- API health online: `https://mellucode.mellutecno.it/v1/health`
- `palestra-demo` e' assegnata a `mellutecno@gmail.com`

Verifiche fatte dopo deploy `0883cd5`:
- build Console produzione: OK
- PM2 `mellucode-api`: online
- nginx config test + reload: OK
- smoke `GET /v1/health`: OK
- suite API server con `TEST_DATABASE_URL=mellucode_test`, SMTP json e OpenRouter mock: **115/115 PASS**

Modifiche online importanti:
- Console: il componente `Modal` ora usa `createPortal(document.body)`, overlay `z-[100]`, scroll sulla pagina del popup e non piu' sul box interno con `overflow-hidden`. Questo serve a correggere i popup tagliati/non scrollabili e il caso "schermo scuro ma finestra non visibile".
- Console: `Nuova app` ora richiede anche il campo **Cosa vuoi creare?**. Non crea piu' solo un contenitore col titolo: salva le istruzioni iniziali in `tenant.metadata.initialPrompt`.
- Console: rimossi altri testi tecnici visibili all'utente, ad esempio "slug" diventa "indirizzo app" e "Entita'" diventa "Tabelle dati".
- Console: pagina dettaglio app con azioni `Modifica` e `Elimina app`; icona generica app invece della lettera gigante.
- API: `POST /v1/tenants` accetta `initialPrompt` e lo salva in `metadata.initialPrompt`.
- API: `PATCH /v1/tenants/:id` modifica nome, indirizzo app e registrazione pubblica.
- API: `DELETE /v1/tenants/:id` elimina app/tenant di proprieta' del creator, con cascade DB e rimozione best-effort dei file fisici.

Documenti aggiunti/da tenere presenti:
- `docs/orchestrator-design-quality.md`
  Regola prodotto per iniettare nei prompt dell'orchestrator: le app generate devono avere UI premium, non generica, con palette coerente al settore, contrasto leggibile, responsive, stati loading/empty/error curati.
- `docs/app-lifecycle.md`
  Flusso prodotto per ciclo di vita app: modifica, eliminazione, future change request AI, preview, approvazione e deploy.

Prossimi passi per chi riprende:
1. Verificare da browser reale:
   - popup `Nuova app` scrollabile su desktop;
   - popup `Modifica app` scrollabile;
   - popup `Elimina app` visibile quando si clicca "Elimina app";
   - app eliminata sparisce dalla dashboard.
2. Collegare `initialPrompt` alla futura pipeline orchestrator Fase 2: prompt utente -> SDD -> prezzo -> conferma pagamento/credito -> generazione app.
3. Progettare il flusso "modifica app con AI": change request, preventivo costo, approvazione, patch, preview, deploy.

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
