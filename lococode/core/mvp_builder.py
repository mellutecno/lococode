import html
import json
import re
import traceback
from datetime import datetime
from pathlib import Path
from typing import Any

import requests

from lococode.core.builder_engine import BuilderEngine


ROOT_DIR = Path(__file__).resolve().parents[2]
USER_DATA_DIR = ROOT_DIR / "user_data"
APPS_DIR = USER_DATA_DIR / "apps"
CONFIG_PATH = USER_DATA_DIR / "config.json"
STATE_PATH = USER_DATA_DIR / "mvp_state.json"

COMMON_MODELS = [
    "deepseek/deepseek-v4-flash",
    "deepseek/deepseek-v4-pro",
    "deepseek/deepseek-v3.2",
    "deepseek/deepseek-chat-v3.1",
    "openai/gpt-4.1",
    "openai/gpt-chat-latest",
    "anthropic/claude-sonnet-4",
    "google/gemini-3.1-flash-lite",
    "google/gemini-2.5-pro",
    "moonshotai/kimi-k2.6",
    "qwen/qwen3-coder",
]


class MvpBuilder:
    def __init__(self):
        USER_DATA_DIR.mkdir(parents=True, exist_ok=True)
        APPS_DIR.mkdir(parents=True, exist_ok=True)
        self.file_engine = BuilderEngine()

    def load_config(self) -> dict[str, Any]:
        defaults = {
            "openrouter_api_key": "",
            "default_provider": "OpenRouter",
            "default_model": "moonshotai/kimi-k2.6",
        }

        if not CONFIG_PATH.exists():
            return defaults

        try:
            data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
        except Exception:
            return defaults

        for key, value in defaults.items():
            data.setdefault(key, value)
        return data

    def save_config(self, api_key: str, model: str) -> dict[str, Any]:
        config = self.load_config()
        config["openrouter_api_key"] = api_key.strip()
        config["default_provider"] = "OpenRouter"
        config["default_model"] = self.normalize_model_id(model) or config["default_model"]
        CONFIG_PATH.write_text(
            json.dumps(config, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )
        return config

    def load_state(self) -> dict[str, Any]:
        if not STATE_PATH.exists():
            return {"apps": []}

        try:
            state = json.loads(STATE_PATH.read_text(encoding="utf-8"))
        except Exception:
            return {"apps": []}

        state.setdefault("apps", [])
        return state

    def save_state(self, state: dict[str, Any]) -> None:
        STATE_PATH.write_text(
            json.dumps(state, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def list_apps(self) -> list[dict[str, Any]]:
        state = self.load_state()
        apps = state.get("apps", [])
        dirty = False
        existing = []
        for app in apps:
            if Path(app.get("path", "")).exists():
                preview_file = Path(app.get("preview_file", ""))
                if app.get("status") == "building" and not preview_file.exists():
                    app["status"] = "interrupted"
                    dirty = True
                existing.append(app)
        if dirty:
            state["apps"] = apps
            self.save_state(state)
        existing.sort(key=lambda item: item.get("updated_at", ""), reverse=True)
        return existing

    def get_app(self, app_id: str) -> dict[str, Any] | None:
        for app in self.load_state().get("apps", []):
            if app.get("id") == app_id:
                return app
        return None

    def create_app_from_prompt(
        self,
        prompt: str,
        model: str | None = None,
        use_ai: bool = True,
    ) -> dict[str, Any]:
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("Scrivi cosa vuoi costruire.")

        state = self.load_state()
        name = self._title_from_prompt(prompt)
        slug = self._unique_slug(name, state.get("apps", []))
        app_id = f"app-{datetime.now().strftime('%Y%m%d%H%M%S')}-{slug}"
        app_path = APPS_DIR / slug
        app_path.mkdir(parents=True, exist_ok=True)

        now = self._now()
        app_record = {
            "id": app_id,
            "name": name,
            "slug": slug,
            "path": str(app_path),
            "created_at": now,
            "updated_at": now,
            "prompt": prompt,
            "status": "building",
            "preview_file": "",
            "files": [],
            "messages": [
                {
                    "role": "user",
                    "content": prompt,
                    "at": now,
                }
            ],
        }

        state["apps"].insert(0, app_record)
        self.save_state(state)

        result = self._generate_files(app_path, prompt, model=model, use_ai=use_ai)
        app_record.update(
            {
                "updated_at": self._now(),
                "status": "ready",
                "preview_file": result["preview_file"],
                "files": self._list_project_files(app_path),
            }
        )
        app_record["messages"].append(
            {
                "role": "assistant",
                "content": result["assistant_message"],
                "at": self._now(),
            }
        )
        self._replace_app_record(app_record)
        return {"app": app_record, **result}

    def rebuild_app(
        self,
        app_id: str,
        prompt: str,
        model: str | None = None,
        use_ai: bool = True,
    ) -> dict[str, Any]:
        prompt = prompt.strip()
        if not prompt:
            raise ValueError("Scrivi una modifica da applicare.")

        app = self.get_app(app_id)
        if not app:
            raise ValueError("App non trovata.")

        app_path = Path(app["path"])
        app_path.mkdir(parents=True, exist_ok=True)
        app.setdefault("messages", []).append(
            {
                "role": "user",
                "content": prompt,
                "at": self._now(),
            }
        )
        app["status"] = "building"
        self._replace_app_record(app)

        result = self._generate_files(app_path, prompt, model=model, use_ai=use_ai)
        app["updated_at"] = self._now()
        app["status"] = "ready"
        app["preview_file"] = result["preview_file"]
        app["files"] = self._list_project_files(app_path)
        app.setdefault("messages", []).append(
            {
                "role": "assistant",
                "content": result["assistant_message"],
                "at": self._now(),
            }
        )
        self._replace_app_record(app)
        return {"app": app, **result}

    def _generate_files(
        self,
        app_path: Path,
        prompt: str,
        model: str | None,
        use_ai: bool,
    ) -> dict[str, Any]:
        ai_text = ""
        ai_error = ""
        applied = {"created": [], "updated": [], "errors": [], "total_operations": 0}

        if use_ai:
            try:
                ai_text = self._call_openrouter(prompt, model=model)
            except Exception:
                ai_error = traceback.format_exc()

        if ai_text:
            applied = self.file_engine.apply_response(str(app_path), ai_text)

        preview_file = app_path / "index.html"
        used_ai = bool(ai_text and applied.get("total_operations", 0) and preview_file.exists())

        if not used_ai:
            fallback_files = self._fallback_files(prompt)
            self._write_files(app_path, fallback_files)
            preview_file = app_path / "index.html"

        self._write_manifest(app_path, prompt, used_ai, applied, ai_error)

        created = len(applied.get("created", []))
        updated = len(applied.get("updated", []))
        mode = "OpenRouter" if used_ai else "fallback locale"
        assistant_message = (
            f"App generata con {mode}. File creati: {created}. "
            f"File aggiornati: {updated}. Preview pronta: {preview_file.name}."
        )

        if ai_error:
            assistant_message += "\n\nNota: OpenRouter non ha risposto correttamente, quindi ho usato il generatore locale."

        return {
            "assistant_message": assistant_message,
            "ai_text": ai_text,
            "applied": applied,
            "preview_file": str(preview_file),
            "used_ai": used_ai,
        }

    def _call_openrouter(self, prompt: str, model: str | None = None) -> str:
        config = self.load_config()
        api_key = config.get("openrouter_api_key", "").strip()
        selected_model = self.normalize_model_id(model or config.get("default_model") or "")

        if not api_key:
            return ""

        system_prompt = """
You are LocoCode, an AI app builder.
Create a complete static MVP web app from the user's request.
Return only file blocks in this format:

```file path="index.html"
full file content
```

Optional additional files may use the same format.
Rules:
- Always create index.html.
- The app must be complete, polished, responsive, and usable without a build step.
- Use inline CSS and JavaScript inside index.html for the preview.
- Do not use external CDNs, remote assets, or API calls.
- Brand it as LocoCode only in a tiny footer or metadata.
""".strip()

        response = requests.post(
            "https://openrouter.ai/api/v1/chat/completions",
            headers={
                "Authorization": f"Bearer {api_key}",
                "Content-Type": "application/json",
                "HTTP-Referer": "https://lococode.local",
                "X-Title": "LocoCode",
            },
            json={
                "model": selected_model,
                "messages": [
                    {"role": "system", "content": system_prompt},
                    {"role": "user", "content": prompt},
                ],
                "max_tokens": 4500,
                "temperature": 0.25,
            },
            timeout=(8, 35),
        )

        if not response.ok:
            detail = response.text[:900]
            raise RuntimeError(
                f"OpenRouter error {response.status_code} for model {selected_model}: {detail}"
            )

        data = response.json()
        choices = data.get("choices") or []
        if not choices:
            raise RuntimeError("OpenRouter returned no choices.")

        message = choices[0].get("message") or {}
        return message.get("content") or ""

    def normalize_model_id(self, model: str | None) -> str:
        raw = (model or "").strip()
        if not raw:
            return ""

        lowered = raw.lower()
        aliases = {
            "deepseek": "deepseek/deepseek-v4-flash",
            "deepseek flash": "deepseek/deepseek-v4-flash",
            "deepseek pro": "deepseek/deepseek-v4-pro",
            "deepseek v4": "deepseek/deepseek-v4-flash",
            "deepseek v4 pro": "deepseek/deepseek-v4-pro",
            "deepseek v3.2": "deepseek/deepseek-v3.2",
            "gpt-4.1": "openai/gpt-4.1",
            "gemini": "google/gemini-3.1-flash-lite",
            "kimi": "moonshotai/kimi-k2.6",
        }
        if lowered in aliases:
            return aliases[lowered]

        return raw

    def _fallback_files(self, prompt: str) -> dict[str, str]:
        title = self._title_from_prompt(prompt)
        lower = prompt.lower()

        if any(word in lower for word in ["todo", "task", "lista", "kanban"]):
            index = self._todo_html(title, prompt)
        elif any(word in lower for word in ["login", "signup", "sign up", "register", "form"]):
            index = self._signup_html(title, prompt)
        elif any(word in lower for word in ["dashboard", "crm", "admin", "analytics"]):
            index = self._dashboard_html(title, prompt)
        else:
            index = self._landing_html(title, prompt)

        return {
            "index.html": index,
            "README.md": self._readme(title, prompt),
        }

    def _shell_html(self, title: str, prompt: str, body: str, script: str = "") -> str:
        safe_title = html.escape(title)
        safe_prompt = html.escape(prompt)
        return f"""<!doctype html>
<html lang="it">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>{safe_title}</title>
  <style>
    :root {{
      --ink: #121826;
      --muted: #667085;
      --panel: rgba(255, 255, 255, 0.88);
      --line: rgba(20, 24, 38, 0.1);
      --blue: #18a8ff;
      --pink: #ff2ebd;
      --violet: #7c3cff;
      --soft: #f6f3ff;
    }}
    * {{ box-sizing: border-box; }}
    body {{
      margin: 0;
      color: var(--ink);
      font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background:
        linear-gradient(120deg, rgba(24, 168, 255, 0.16), transparent 28%),
        linear-gradient(250deg, rgba(255, 46, 189, 0.18), transparent 32%),
        #fbfaff;
      min-height: 100vh;
    }}
    .shell {{
      width: min(1120px, calc(100% - 32px));
      margin: 0 auto;
      padding: 28px 0 48px;
    }}
    .topbar {{
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 28px;
    }}
    .brand {{
      display: flex;
      align-items: center;
      gap: 12px;
      font-weight: 800;
      letter-spacing: 0;
    }}
    .mark {{
      width: 40px;
      height: 40px;
      border-radius: 12px;
      background: linear-gradient(135deg, var(--blue), var(--pink));
      box-shadow: 0 14px 30px rgba(124, 60, 255, 0.24);
    }}
    .badge {{
      border: 1px solid var(--line);
      border-radius: 999px;
      padding: 8px 12px;
      color: var(--muted);
      background: rgba(255, 255, 255, 0.72);
      font-size: 13px;
    }}
    .hero {{
      display: grid;
      grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
      gap: 22px;
      align-items: stretch;
    }}
    .panel {{
      background: var(--panel);
      border: 1px solid var(--line);
      border-radius: 18px;
      box-shadow: 0 24px 70px rgba(44, 52, 80, 0.12);
      backdrop-filter: blur(16px);
    }}
    .intro {{
      padding: 42px;
      min-height: 440px;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }}
    h1 {{
      margin: 0;
      font-size: clamp(38px, 7vw, 78px);
      line-height: 0.95;
      letter-spacing: 0;
    }}
    .lede {{
      color: var(--muted);
      font-size: 18px;
      line-height: 1.7;
      margin: 22px 0 0;
      max-width: 62ch;
    }}
    .actions {{
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      margin-top: 30px;
    }}
    button, .button {{
      border: 0;
      border-radius: 12px;
      padding: 12px 16px;
      font: inherit;
      font-weight: 700;
      cursor: pointer;
      background: #121826;
      color: #fff;
    }}
    .button.secondary, button.secondary {{
      background: #fff;
      color: var(--ink);
      border: 1px solid var(--line);
    }}
    .side {{
      padding: 22px;
      display: flex;
      flex-direction: column;
      gap: 14px;
    }}
    .card {{
      border: 1px solid var(--line);
      border-radius: 14px;
      padding: 18px;
      background: #fff;
    }}
    .card h2, .card h3 {{
      margin: 0 0 8px;
      font-size: 18px;
    }}
    .card p {{
      margin: 0;
      color: var(--muted);
      line-height: 1.55;
    }}
    .grid {{
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-top: 22px;
    }}
    input, textarea {{
      width: 100%;
      border: 1px solid var(--line);
      border-radius: 12px;
      padding: 12px 13px;
      font: inherit;
      color: var(--ink);
      background: #fff;
    }}
    label {{
      display: block;
      font-size: 13px;
      font-weight: 700;
      color: var(--muted);
      margin-bottom: 7px;
    }}
    .footer {{
      color: var(--muted);
      font-size: 13px;
      margin-top: 22px;
    }}
    @media (max-width: 820px) {{
      .hero {{ grid-template-columns: 1fr; }}
      .intro {{ padding: 28px; min-height: auto; }}
      .grid {{ grid-template-columns: 1fr; }}
    }}
  </style>
</head>
<body>
  <main class="shell">
    <header class="topbar">
      <div class="brand"><span class="mark"></span><span>{safe_title}</span></div>
      <span class="badge">Generato con LocoCode</span>
    </header>
    {body}
    <p class="footer">Prompt originale: {safe_prompt}</p>
  </main>
  <script>{script}</script>
</body>
</html>
"""

    def _landing_html(self, title: str, prompt: str) -> str:
        body = f"""
<section class="hero">
  <div class="panel intro">
    <span class="badge">MVP pronto</span>
    <h1>{html.escape(title)}</h1>
    <p class="lede">Una prima versione pulita e navigabile, generata dal prompt. Personalizza testi, sezioni e chiamate all'azione direttamente da LocoCode.</p>
    <div class="actions">
      <button onclick="document.querySelector('#contact').scrollIntoView({{behavior:'smooth'}})">Inizia ora</button>
      <button class="secondary" onclick="document.querySelector('#features').scrollIntoView({{behavior:'smooth'}})">Vedi funzioni</button>
    </div>
  </div>
  <aside class="panel side" id="features">
    <div class="card"><h2>Esperienza chiara</h2><p>Layout responsive, gerarchia semplice e contenuti gia pronti per una demo.</p></div>
    <div class="card"><h2>Brand moderno</h2><p>Palette ispirata al neon LocoCode con contrasto alto e superfici leggere.</p></div>
    <div class="card"><h2>Pronta da iterare</h2><p>Chiedi a LocoCode una modifica e questa preview verra aggiornata.</p></div>
  </aside>
</section>
<section class="panel" id="contact" style="margin-top:22px;padding:28px">
  <h2 style="margin:0 0 10px">Prossimo passo</h2>
  <p class="lede" style="margin:0">Trasforma questo MVP in prodotto: aggiungi dati reali, autenticazione, checkout o dashboard.</p>
</section>
"""
        return self._shell_html(title, prompt, body)

    def _todo_html(self, title: str, prompt: str) -> str:
        body = f"""
<section class="panel intro" style="min-height:auto">
  <span class="badge">Task manager</span>
  <h1>{html.escape(title)}</h1>
  <p class="lede">Aggiungi, completa e filtra attivita. I dati restano salvati nel browser.</p>
  <div class="actions">
    <input id="newTask" placeholder="Scrivi una nuova attivita">
    <button onclick="addTask()">Aggiungi</button>
  </div>
  <div class="grid" id="taskGrid"></div>
</section>
"""
        script = """
const key = "lococode_tasks";
const seed = [
  { text: "Definire la prima schermata", done: false },
  { text: "Aggiungere stato locale", done: true },
  { text: "Preparare una demo", done: false }
];
let tasks = JSON.parse(localStorage.getItem(key) || "null") || seed;
function save(){ localStorage.setItem(key, JSON.stringify(tasks)); }
function render(){
  const grid = document.getElementById("taskGrid");
  grid.innerHTML = "";
  tasks.forEach((task, index) => {
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h3>${task.done ? "Completata" : "Da fare"}</h3><p>${task.text}</p><div class="actions"><button class="secondary" onclick="toggleTask(${index})">${task.done ? "Riapri" : "Completa"}</button><button onclick="removeTask(${index})">Elimina</button></div>`;
    grid.appendChild(card);
  });
}
function addTask(){
  const input = document.getElementById("newTask");
  const text = input.value.trim();
  if(!text) return;
  tasks.unshift({ text, done:false });
  input.value = "";
  save();
  render();
}
function toggleTask(index){ tasks[index].done = !tasks[index].done; save(); render(); }
function removeTask(index){ tasks.splice(index, 1); save(); render(); }
document.getElementById("newTask").addEventListener("keydown", event => {
  if(event.key === "Enter") addTask();
});
render();
"""
        return self._shell_html(title, prompt, body, script)

    def _signup_html(self, title: str, prompt: str) -> str:
        body = f"""
<section class="hero">
  <div class="panel intro">
    <span class="badge">Onboarding</span>
    <h1>{html.escape(title)}</h1>
    <p class="lede">Un flusso di registrazione pronto per validare interesse, raccogliere contatti e mostrare conferma immediata.</p>
  </div>
  <form class="panel side" onsubmit="submitForm(event)">
    <div class="card">
      <label>Nome</label>
      <input id="name" required placeholder="Mario Rossi">
    </div>
    <div class="card">
      <label>Email</label>
      <input id="email" required type="email" placeholder="nome@email.com">
    </div>
    <div class="card">
      <label>Obiettivo</label>
      <textarea id="goal" rows="4" placeholder="Cosa vuoi ottenere?"></textarea>
    </div>
    <button type="submit">Crea account</button>
    <p id="formStatus" class="footer"></p>
  </form>
</section>
"""
        script = """
function submitForm(event){
  event.preventDefault();
  const name = document.getElementById("name").value.trim();
  document.getElementById("formStatus").textContent = `Perfetto ${name}, la richiesta e stata registrata in questa demo.`;
}
"""
        return self._shell_html(title, prompt, body, script)

    def _dashboard_html(self, title: str, prompt: str) -> str:
        body = f"""
<section class="panel intro" style="min-height:auto">
  <span class="badge">Dashboard</span>
  <h1>{html.escape(title)}</h1>
  <p class="lede">Panoramica operativa con metriche, attivita e priorita.</p>
  <div class="grid">
    <div class="card"><h2>Utenti</h2><p style="font-size:34px;color:#121826;font-weight:800">1.284</p></div>
    <div class="card"><h2>Revenue</h2><p style="font-size:34px;color:#121826;font-weight:800">+18%</p></div>
    <div class="card"><h2>Task aperti</h2><p style="font-size:34px;color:#121826;font-weight:800">24</p></div>
  </div>
</section>
<section class="hero" style="margin-top:22px">
  <div class="panel side">
    <div class="card"><h2>Pipeline</h2><p>Lead qualificati, demo programmate e contratti in revisione.</p></div>
    <div class="card"><h2>Alert</h2><p>Due clienti enterprise richiedono follow-up entro oggi.</p></div>
  </div>
  <div class="panel side">
    <div class="card"><h2>Roadmap</h2><p>Integra dati reali, ruoli utente e notifiche nel prossimo sprint.</p></div>
    <div class="card"><h2>Qualita</h2><p>MVP pronto per una validazione rapida con stakeholder.</p></div>
  </div>
</section>
"""
        return self._shell_html(title, prompt, body)

    def _readme(self, title: str, prompt: str) -> str:
        return f"""# {title}

App generata con LocoCode MVP.

## Prompt

{prompt}

## Preview

Apri `index.html` nel browser oppure usa il pannello Preview di LocoCode.
"""

    def _write_files(self, root: Path, files: dict[str, str]) -> None:
        for rel_path, content in files.items():
            target = root / rel_path
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_text(content.strip() + "\n", encoding="utf-8")

    def _write_manifest(
        self,
        root: Path,
        prompt: str,
        used_ai: bool,
        applied: dict[str, Any],
        ai_error: str,
    ) -> None:
        manifest = {
            "prompt": prompt,
            "generated_at": self._now(),
            "used_ai": used_ai,
            "applied": applied,
            "ai_error": "present" if ai_error else "",
        }
        (root / "lococode.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    def _replace_app_record(self, app_record: dict[str, Any]) -> None:
        state = self.load_state()
        apps = state.get("apps", [])
        replaced = False
        for index, app in enumerate(apps):
            if app.get("id") == app_record.get("id"):
                apps[index] = app_record
                replaced = True
                break
        if not replaced:
            apps.insert(0, app_record)
        state["apps"] = apps
        self.save_state(state)

    def _list_project_files(self, root: Path) -> list[str]:
        ignored = {".git", "__pycache__", "node_modules", "dist", "build"}
        files = []
        for path in root.rglob("*"):
            if path.is_dir():
                continue
            if any(part in ignored for part in path.parts):
                continue
            files.append(str(path.relative_to(root)).replace("\\", "/"))
        return sorted(files)

    def _title_from_prompt(self, prompt: str) -> str:
        words = re.findall(r"[A-Za-z0-9]+", prompt)
        if not words:
            return "LocoCode App"
        title_words = words[:4]
        return " ".join(word.capitalize() for word in title_words)

    def _unique_slug(self, name: str, apps: list[dict[str, Any]]) -> str:
        base = self._safe_slug(name)
        used = {app.get("slug") for app in apps}
        slug = base
        counter = 2
        while slug in used or (APPS_DIR / slug).exists():
            slug = f"{base}-{counter}"
            counter += 1
        return slug

    def _safe_slug(self, text: str) -> str:
        slug = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
        return slug or "lococode-app"

    def _now(self) -> str:
        return datetime.now().strftime("%Y-%m-%d %H:%M:%S")
