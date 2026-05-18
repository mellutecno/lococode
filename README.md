# MelluCode

AI app builder. L'utente descrive un'app, MelluCode la genera completa di frontend, dati e auth, deployata sul nostro server.

## Stato

🚧 In costruzione (Fase 1 — backend gestito interno).

Stato attuale: `mellucode-api` e' online su `https://mellucode.mellutecno.it/v1/health` con auth creator, tenant/app-auth, Data API multi-tenant, file storage, invio email gestito e SDK frontend auth/data/files/email funzionanti.

Il codice precedente ("orchestrator monolite + FastAPI generato per ogni app", brand "LocoCode") e' archiviato sul tag git `legacy-v1`. Non viene piu' sviluppato.

## Architettura (in sintesi)

- **Backend gestito** `platform/api/` — fornisce auth, data CRUD, file storage, email, AI proxy a tutte le app generate. **L'AI generata non scrive mai codice backend.**
- **SDK frontend** `platform/sdk/` — libreria che le app generate importano per parlare col backend gestito.
- **Orchestrator AI** (in arrivo Fase 2) — chiede prompt utente, genera solo schema + frontend React+Tailwind, lascia il backend al servizio gestito.

Dettagli in [docs/architecture.md](docs/architecture.md) (in arrivo).

## Roadmap

- **Fase 1** (3-4 sett.): backend gestito (auth, data API, storage, email, AI proxy)
- **Fase 2** (2-3 sett.): nuovo orchestrator (AI scrive solo schema+frontend, mai backend)
- **Fase 3** (2-3 sett.): editor live + iterazione chat + sistema crediti AI
- **Fase 4** (1-2 sett.): 3-4 template di partenza (pizzeria, gestionale, marketplace, ecommerce)

## Dominio

Produzione API: `https://mellucode.mellutecno.it`

## License

Proprietario.
