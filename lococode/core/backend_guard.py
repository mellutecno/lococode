from pathlib import Path
from typing import Dict, List, Any


class BackendGuard:
    """
    Rinforzo backend per LocoCode.

    Obiettivo:
    - verificare che un backend FastAPI generato abbia i file minimi
    - riparare automaticamente i pezzi mancanti senza sovrascrivere codice esistente
    """

    REQUIRED_PACKAGES = [
        "fastapi",
        "uvicorn[standard]",
        "pydantic",
        "python-dotenv",
    ]

    def repair_missing_backend_basics(self, project_path: str) -> Dict[str, Any]:
        root = Path(project_path)
        backend = root / "backend"
        app_dir = backend / "app"
        requirements = backend / "requirements.txt"
        main_py = app_dir / "main.py"
        init_py = app_dir / "__init__.py"
        env_example = backend / ".env.example"

        created: List[str] = []
        updated: List[str] = []
        skipped: List[str] = []
        errors: List[str] = []

        try:
            backend.mkdir(parents=True, exist_ok=True)
            app_dir.mkdir(parents=True, exist_ok=True)

            if not requirements.exists():
                requirements.write_text(
                    "\n".join(self.REQUIRED_PACKAGES) + "\n",
                    encoding="utf-8",
                )
                created.append("backend/requirements.txt")
            else:
                text = requirements.read_text(encoding="utf-8", errors="ignore")
                lower = text.lower()
                additions = []

                for package in self.REQUIRED_PACKAGES:
                    base_name = package.split("[")[0].lower()
                    if base_name not in lower:
                        additions.append(package)

                if additions:
                    if text and not text.endswith("\n"):
                        text += "\n"
                    text += "\n".join(additions) + "\n"
                    requirements.write_text(text, encoding="utf-8")
                    updated.append("backend/requirements.txt")
                else:
                    skipped.append("backend/requirements.txt già completo")

            if not init_py.exists():
                init_py.write_text("", encoding="utf-8")
                created.append("backend/app/__init__.py")
            else:
                skipped.append("backend/app/__init__.py già presente")

            if not main_py.exists():
                main_py.write_text(self.default_main_py(), encoding="utf-8")
                created.append("backend/app/main.py")
            else:
                skipped.append("backend/app/main.py già presente, non sovrascritto")

            if not env_example.exists():
                env_example.write_text(self.default_env_example(), encoding="utf-8")
                created.append("backend/.env.example")
            else:
                skipped.append("backend/.env.example già presente")

        except Exception as e:
            errors.append(str(e))

        return {
            "ok": not errors,
            "created": created,
            "updated": updated,
            "skipped": skipped,
            "errors": errors,
        }

    def default_main_py(self) -> str:
        return """from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="LocoCode Generated Backend",
    version="0.1.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "name": "LocoCode Generated Backend",
        "status": "online",
    }


@app.get("/health")
def health():
    return {
        "ok": True,
    }
"""

    def default_env_example(self) -> str:
        return """APP_NAME=LocoCode Generated Backend
ENVIRONMENT=development
DATABASE_URL=sqlite:///./dev.db
SECRET_KEY=change-me
"""
