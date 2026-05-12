import json
import os
import traceback
from pathlib import Path

from openai import OpenAI

from lococode.core.orchestrator import SDDOrchestrator


CONFIG_PATH = os.path.join("user_data", "config.json")


class ProviderManager:
    def __init__(self):
        self.orchestrator = SDDOrchestrator()

    def load_config(self):
        if not os.path.exists(CONFIG_PATH):
            return {}

        try:
            with open(CONFIG_PATH, "r", encoding="utf-8") as f:
                return json.load(f)
        except Exception:
            return {}

    def load_project_memory(self, project_path):
        if not project_path:
            return "Nessuna memoria progetto disponibile."

        base_path = Path(project_path)

        memory_files = [
            base_path / ".lc" / "spec" / "requirements.md",
            base_path / ".lc" / "spec" / "architecture.md",
            base_path / ".lc" / "spec" / "tasks.md",
            base_path / ".lc" / "memory" / "project_context.md",
        ]

        chunks = []

        for file_path in memory_files:
            if file_path.exists():
                try:
                    content = file_path.read_text(encoding="utf-8")

                    if content.strip():
                        chunks.append(
                            f"\n\n--- FILE: {file_path.relative_to(base_path)} ---\n{content}"
                        )
                except Exception:
                    chunks.append(
                        f"\n\n--- FILE NON LEGGIBILE: {file_path} ---"
                    )

        if not chunks:
            return "Nessun file .lc/spec o .lc/memory trovato nel progetto."

        full_context = "\n".join(chunks)

        max_chars = 30000

        if len(full_context) > max_chars:
            full_context = full_context[:max_chars] + "\n\n[CONTESTO TAGLIATO: troppo lungo]"

        return full_context

    def send_message(self, provider_name, model, agent, user_message, project_path=None):
        if provider_name == "OpenRouter":
            return self.send_openrouter_message(
                model=model,
                agent=agent,
                user_message=user_message,
                project_path=project_path
            )

        return (
            f"Provider {provider_name} non ancora collegato.\n\n"
            f"Per ora usa OpenRouter."
        )

    def send_openrouter_message(self, model, agent, user_message, project_path=None):
        config = self.load_config()
        api_key = config.get("openrouter_api_key", "").strip()

        if not api_key:
            return (
                "Manca la API key OpenRouter.\n\n"
                "Vai su Impostazioni, incolla la tua API key OpenRouter e premi Salva."
            )

        agent_system_prompt = agent.get("system_prompt", "")

        system_prompt = self.orchestrator.build_system_prompt(
            agent_system_prompt=agent_system_prompt,
            project_path=project_path
        )

        project_memory = self.load_project_memory(project_path)

        final_user_prompt = f"""
Richiesta utente:

{user_message}

MEMORIA PROGETTO DISPONIBILE:
{project_memory}

ISTRUZIONI:
- Comportati come SDD Orchestrator.
- Usa la memoria progetto se presente.
- Non ripartire da zero se esistono già requirements, architecture o tasks.
- Se l'utente chiede "continua", prosegui dal piano operativo salvato.
- Se l'utente chiede di generare/modificare file, indica chiaramente quali file creare o modificare.
- Non dire di aver modificato file se non è realmente successo.
""".strip()

        try:
            client = OpenAI(
                base_url="https://openrouter.ai/api/v1",
                api_key=api_key,
                default_headers={
                    "HTTP-Referer": "https://lococode.local",
                    "X-Title": "LocoCode"
                }
            )

            completion = client.chat.completions.create(
                model=model,
                messages=[
                    {
                        "role": "system",
                        "content": system_prompt
                    },
                    {
                        "role": "user",
                        "content": final_user_prompt
                    }
                ],
                temperature=0.25
            )

            return completion.choices[0].message.content

        except Exception as e:
            return (
                "Errore durante la chiamata a OpenRouter.\n\n"
                f"Dettaglio errore:\n{str(e)}\n\n"
                "Traceback tecnico:\n"
                f"{traceback.format_exc()}"
            )
