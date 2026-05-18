# MelluCode Console

Il dashboard del **creator** MelluCode: la pagina dove chi compra MelluCode si logga, vede le sue app, ne crea di nuove. Vive a root di `mellucode.mellutecno.it`.

🌐 Live: https://mellucode.mellutecno.it/

## Cosa fa
- Login + registrazione creator (`/v1/auth/*`)
- Lista delle app possedute (`GET /v1/tenants`)
- Creazione nuova app via modale (`POST /v1/tenants`)
- Dettaglio app con info tenant + link al frontend (per ora `/apps/{slug}/` se generato da Fase 2 oppure `/demo/palestra/` se e' la demo pre-seedata)
- Placeholder "Frontend AI" per Fase 2 (prompt-to-app)

## Stack
- React + Vite + Tailwind 3
- lucide-react (icons)
- React Router 6
- Niente SDK: fetch dirette via `src/lib/api.js` (la Console usa JWT creator, non app-auth come fa l'SDK)

## Design system
**Palette diversa dalla demo palestra** per dimostrare la palette-flessibilita':
- `ink.*` = pure black + grey-blue (vibe Vercel/Cursor)
- `accent.*` = cyan electric (#22d3ee / #06b6d4)
- secondary hint violet sotto l'aurora di sfondo

Stesso design system (tokens, shadows glow, glass, skeleton, modal animato, page enter rise) — solo i colori cambiano. E' la prova che lo stesso template puo' vestire app diverse.

## Sviluppo locale
```sh
npm install
npm run dev     # vite dev su :5174, /v1/* proxy verso prod
npm run build
```

## Deploy (rifacibile)
```sh
npm run build
scp -r dist/* root@server:/opt/mellucode/console/
# nginx vhost gia' configurato: location / serve la SPA, /v1/ proxa API, /demo/ servono i demo
```

## Note tecniche
- React Router base `/` (Console e' a root). SPA fallback via nginx `try_files`.
- `/assets/*` ha cache 1y immutable. `/index.html` no-store per pickup nuovi deploy.
- `lib/api.js` ha auto-refresh access token su 401: usa il refresh token salvato in localStorage.
- Modal premium con Esc + click-on-backdrop, backdrop blur + scale-in.
