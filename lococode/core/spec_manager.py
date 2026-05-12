from pathlib import Path
from datetime import datetime


class SpecManager:
    def __init__(self):
        pass

    def create_spec_files(self, project_path, source_text):
        if not project_path:
            raise ValueError("Nessun progetto aperto. Apri o crea prima una cartella progetto.")

        base_path = Path(project_path)
        spec_dir = base_path / ".lc" / "spec"
        memory_dir = base_path / ".lc" / "memory"

        spec_dir.mkdir(parents=True, exist_ok=True)
        memory_dir.mkdir(parents=True, exist_ok=True)

        timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")

        sdd_content = f"""
# SDD progetto

Generato da LocoCode il {timestamp}.

## Documento completo

{source_text}
"""

        requirements_content = f"""
# Requirements

Generato da LocoCode il {timestamp}.

## Fonte SDD

{source_text}

## Requisiti funzionali

Da completare e rifinire durante la fase SDD.

## Requisiti non funzionali

Da completare e rifinire durante la fase SDD.

## MVP

Da completare e rifinire durante la fase SDD.
"""

        architecture_content = f"""
# Architecture

Generato da LocoCode il {timestamp}.

## Stack predefinito

- Frontend: React + Vite
- Backend: FastAPI
- Database iniziale: SQLite
- Deploy/backend: Render
- Provider AI: OpenRouter

## Architettura proposta

Da derivare dalla specifica SDD.

## Frontend

Da completare.

## Backend

Da completare.

## Database

Da completare.

## Deploy Render

Da completare.
"""

        tasks_content = f"""
# Tasks

Generato da LocoCode il {timestamp}.

## Piano operativo

Da derivare dalla risposta SDD.

## Task

- [ ] Definire requisiti finali
- [ ] Creare struttura progetto
- [ ] Implementare backend
- [ ] Implementare frontend
- [ ] Collegare frontend/backend
- [ ] Preparare deploy Render
- [ ] Verificare build e avvio locale
"""

        memory_content = f"""
# Project Context

Generato da LocoCode il {timestamp}.

Questo file contiene memoria tecnica del progetto.

## Ultima risposta SDD salvata

{source_text}
"""

        files_written = []

        files = {
            spec_dir / "sdd.md": sdd_content,
            spec_dir / "requirements.md": requirements_content,
            spec_dir / "architecture.md": architecture_content,
            spec_dir / "tasks.md": tasks_content,
            memory_dir / "project_context.md": memory_content,
        }

        for path, content in files.items():
            path.write_text(content.strip() + "\n", encoding="utf-8")
            files_written.append(str(path))

        return files_written
