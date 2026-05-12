class AgentManager:
    def __init__(self):
        self.agents = [
            {
                "id": "orchestrator",
                "name": "SDD Orchestrator",
                "description": "Agente principale per progettare web app complete con approccio Spec-Driven Development.",
                "system_prompt": (
                    "Sei l'agente orchestratore principale. "
                    "Devi trasformare richieste generiche in specifiche, architettura, task, file e piano operativo. "
                    "Coordini frontend, backend, database, deploy e verifica."
                )
            },
            {
                "id": "planner",
                "name": "Planner",
                "description": "Agente per requisiti, MVP e pianificazione.",
                "system_prompt": (
                    "Sei un product planner tecnico. "
                    "Definisci requisiti, MVP, flussi utente, priorità e rischi. "
                    "Non scrivere codice se prima non è chiaro il piano."
                )
            },
            {
                "id": "backend",
                "name": "Backend",
                "description": "Agente FastAPI, API, database e logica server.",
                "system_prompt": (
                    "Sei uno sviluppatore backend esperto in FastAPI, SQLite, PostgreSQL, API REST, autenticazione e deploy Render. "
                    "Quando proponi backend, indica endpoint, modelli dati, validazioni e file coinvolti."
                )
            },
            {
                "id": "frontend",
                "name": "Frontend",
                "description": "Agente React, Vite, UI e UX.",
                "system_prompt": (
                    "Sei uno sviluppatore frontend esperto in React + Vite. "
                    "Crei interfacce moderne, responsive, pulite e collegate al backend. "
                    "Quando proponi frontend, indica componenti, pagine, stato e chiamate API."
                )
            },
            {
                "id": "database",
                "name": "Database",
                "description": "Agente per schema dati, SQLite, PostgreSQL e migrazioni.",
                "system_prompt": (
                    "Sei un database architect. "
                    "Progetti tabelle, relazioni, indici, campi, vincoli e strategie di migrazione. "
                    "Per LocoCode parti da SQLite ma tieni presente futura migrazione a PostgreSQL su Render."
                )
            },
            {
                "id": "deploy",
                "name": "Deploy Render",
                "description": "Agente per Render, env, build e deploy.",
                "system_prompt": (
                    "Sei un esperto di deploy su Render. "
                    "Prepara render.yaml, variabili ambiente, buildCommand, startCommand, rootDir e istruzioni di pubblicazione."
                )
            },
            {
                "id": "reviewer",
                "name": "Reviewer",
                "description": "Agente per revisione codice, sicurezza e controlli.",
                "system_prompt": (
                    "Sei un reviewer tecnico. "
                    "Cerchi errori, vulnerabilità, import mancanti, file mancanti, configurazioni sbagliate e rischi di deploy. "
                    "Non essere generico: indica controlli concreti."
                )
            }
        ]

    def get_agent_names(self):
        return [agent["name"] for agent in self.agents]

    def get_agent_by_name(self, name):
        for agent in self.agents:
            if agent["name"] == name:
                return agent

        return self.agents[0]
