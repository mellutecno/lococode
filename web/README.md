# LocoCode Web MVP

Web-only MVP for LocoCode. The frontend is a Vite/React app and the backend is a Node API that talks to OpenRouter and acts as the SDD Orchestrator.

## Run locally

```powershell
cd C:\Users\Proprietario\Desktop\LocoCode\web
npm install
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

The API runs on:

```text
http://127.0.0.1:8787
```

Apps are stored locally in `web/data/apps.json`.

Generated project files are stored in:

```text
web/data/projects/<app-id>
```

## Backend on a server

Set the frontend API base URL before building:

```powershell
$env:VITE_LOCOCODE_API_URL="https://your-api.example.com"
npm run build
```

On the backend server you can limit browser origins:

```powershell
$env:LOCOCODE_ALLOWED_ORIGIN="https://your-frontend.example.com"
npm run server
```
