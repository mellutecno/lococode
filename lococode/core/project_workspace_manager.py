from pathlib import Path
from datetime import datetime
import json


class ProjectWorkspaceManager:
    def __init__(self):
        pass

    def safe_project_name(self, name):
        name = name.strip().lower()
        allowed = "abcdefghijklmnopqrstuvwxyz0123456789-_"
        cleaned = "".join(c if c in allowed else "-" for c in name)
        cleaned = cleaned.strip("-")
        return cleaned or "nuovo-progetto-lococode"

    def write_file(self, path, content, overwrite=False):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists() and not overwrite:
            return False

        path.write_text(content.strip() + "\n", encoding="utf-8")
        return True

    def create_workspace(self, base_dir, project_name, initial_prompt):
        safe_name = self.safe_project_name(project_name)
        root = Path(base_dir) / safe_name

        if root.exists():
            raise FileExistsError(f"La cartella progetto esiste già: {root}")

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        folders = [
            root,
            root / ".lc",
            root / ".lc" / "spec",
            root / ".lc" / "memory",
            root / ".lc" / "logs",
            root / "frontend",
            root / "backend",
        ]

        for folder in folders:
            folder.mkdir(parents=True, exist_ok=True)

        prompt_text = initial_prompt.strip() or "Prompt iniziale non ancora inserito."
        display_name = project_name.strip() or safe_name

        self.write_file(root / ".lc" / "project.json", json.dumps({
            "display_name": display_name,
            "folder_name": safe_name,
            "created_at": timestamp,
        }, ensure_ascii=False, indent=2))

        self.write_file(root / ".lc" / "spec" / "initial_prompt.md", f"""
# Prompt iniziale

Generato da LocoCode il {timestamp}.

{prompt_text}
""")

        self.write_file(root / ".lc" / "state.json", json.dumps({
            "updated_at": timestamp,
            "phase": "idea_iniziale",
            "label": "Fase: idea iniziale",
            "has_sdd": False,
            "has_requirements": False,
            "has_architecture": False,
            "has_tasks": False,
        }, ensure_ascii=False, indent=2))

        self.write_file(root / ".lc" / "memory" / "project_context.md", f"""
# Project Context

Generato da LocoCode il {timestamp}.

## Prompt iniziale

{prompt_text}

## Note

Questo progetto è gestito da LocoCode in modalità SDD Orchestrator.
""")

        self.write_file(root / ".gitignore", """
# Python
__pycache__/
*.pyc
venv/
.venv/
.env

# Node
node_modules/
dist/
build/

# LocoCode temporary files
.lc/tmp/

# OS
.DS_Store
Thumbs.db
""")

        self.write_file(root / "README.md", f"""
# {display_name}

Progetto creato con LocoCode.

## Prompt iniziale

{prompt_text}

## Stack previsto

- React + Vite
- FastAPI
- SQLite iniziale
- Render per deploy/backend
- OpenRouter per AI orchestration

## Cartelle

```text
.lc/spec/       Specifiche SDD
.lc/memory/     Memoria tecnica progetto
frontend/       Frontend web app
backend/        Backend web app
```
""")

        self.write_file(root / "render.yaml", f"""
services:
  - type: web
    name: {safe_name}-backend
    env: python
    plan: free
    rootDir: backend
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        value: sqlite:///./app.db
      - key: FRONTEND_URL
        value: http://localhost:5173
""")

        return str(root)
