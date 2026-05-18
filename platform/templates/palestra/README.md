# MelluCode Demo · Gestione Palestra

Una vera app React che usa **solo** MelluCode come backend (auth, data, files, AI).
Niente endpoint custom, niente DB lato app, niente codice server scritto a mano.
Dimostra che lo stack v2 regge end-to-end.

🌐 Live: https://mellucode.mellutecno.it/demo/palestra/

## Credenziali demo
- email: `admin@palestra-demo.it`
- password: `Palestra2026!`

(Ruotabili se la demo va in produzione marketing.)

## Cosa fa
- Login utente app via `mc.auth.login`
- Lista membri da `mc.data("members").list()`
- Crea / modifica / elimina membro (`create/update/delete`)
- Upload foto profilo (`mc.files.upload` + `downloadBlob` per visualizzazione)
- Bottone "✨ Genera messaggio" → `mc.ai.chat` (OpenRouter via proxy MelluCode)
- Quota AI a 0.1 credito (configurata sul server, scalata per chiamata)

## Schema entita' `members` (gia' seedata sul server)
```json
{
  "properties": {
    "name":               {"type":"string","minLength":1,"maxLength":120},
    "email":              {"type":"string","format":"email"},
    "phone":              {"type":"string","maxLength":40},
    "subscription_type":  {"type":"string","enum":["monthly","quarterly","yearly","none"]},
    "subscription_until": {"type":"string","format":"date"},
    "photo_file_id":      {"type":"string"},
    "notes":              {"type":"string","maxLength":2000}
  },
  "required": ["name"]
}
```

Permessi: `read=authenticated`, `create=authenticated`, `update=owner_or_admin`, `delete=admin`.

## Sviluppo locale
```sh
npm install
npm run dev     # vite dev su :5173, /v1/* proxy verso prod
npm run build   # bundle in ./dist/
```

## Deploy (rifacibile)
```sh
npm run build
scp -r dist/* root@178.104.175.189:/opt/mellucode/demo/palestra/
# nginx vhost gia' configurato: location /demo/palestra/ + alias
```

## Note tecniche
- `react-router` con `basename="/demo/palestra"` in prod.
- `vite.config.js` con `base="/demo/palestra/"` solo in `mode === 'production'`.
- `ImageFromFileId` fa `mc.files.downloadBlob(id)` → `URL.createObjectURL(blob)` perche'
  l'endpoint binario richiede bearer header e non funziona in `<img src>` diretto.
- AI gestisce graceful il `402` (credito esaurito) con messaggio utente chiaro.
