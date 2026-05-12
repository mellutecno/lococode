import json
import re
from pathlib import Path
from typing import Dict, List, Any, Optional


class BuilderEngine:
    '''
    Motore base di LocoCode.

    Scopo:
    - leggere una risposta AI
    - trovare blocchi file strutturati
    - creare/modificare file reali dentro la cartella progetto
    - impedire scritture fuori dalla root del progetto
    '''

    def get_ai_instructions(self) -> str:
        return '''ISTRUZIONI BUILDER ENGINE LOCOCODE:
Quando devi creare o modificare file reali del progetto, usa SOLO questo formato:

```file path="percorso/relativo/nome_file.ext"
contenuto completo del file
```

Regole:
- Usa percorsi relativi alla root del progetto.
- Non usare percorsi assoluti tipo C:\\ o /home.
- Non scrivere fuori dal progetto.
- Se modifichi un file, restituisci il file completo aggiornato.
- Puoi generare più blocchi file nella stessa risposta.
- Dopo i blocchi file, puoi aggiungere una breve nota operativa.\n\nBACKEND FASTAPI OBBLIGATORIO:
Se il progetto richiede o contiene un backend, devi SEMPRE generare o mantenere questi file:
- backend/requirements.txt
- backend/app/__init__.py
- backend/app/main.py
- backend/.env.example

backend/requirements.txt deve includere almeno:
fastapi
uvicorn[standard]
pydantic
python-dotenv

backend/app/main.py deve contenere almeno:
- FastAPI()
- CORS middleware
- GET /
- GET /health
- avvio compatibile con: python -m uvicorn app.main:app --reload

Non lasciare mai una cartella backend vuota o senza requirements.txt.
Non creare codice backend che richiede pacchetti non presenti in requirements.txt.'''.strip()

    def has_file_operations(self, response_text: str) -> bool:
        return bool(self.parse_operations(response_text))

    def parse_operations(self, response_text: str) -> List[Dict[str, Any]]:
        if not response_text:
            return []

        operations: List[Dict[str, Any]] = []

        operations.extend(self._parse_json_blocks(response_text))
        operations.extend(self._parse_fenced_file_blocks(response_text))
        operations.extend(self._parse_xml_file_tags(response_text))

        seen = set()
        unique: List[Dict[str, Any]] = []

        for op in operations:
            key = (op.get("path", ""), op.get("action", "write"), op.get("content", ""))
            if key in seen:
                continue
            seen.add(key)
            unique.append(op)

        return unique

    def apply_response(self, project_path: str, response_text: str) -> Dict[str, Any]:
        root = Path(project_path).resolve()
        operations = self.parse_operations(response_text)

        result = {
            "ok": True,
            "created": [],
            "updated": [],
            "skipped": [],
            "errors": [],
            "total_operations": len(operations),
        }

        if not root.exists():
            result["ok"] = False
            result["errors"].append(f"Cartella progetto non trovata: {root}")
            return result

        for op in operations:
            rel_path = op.get("path", "").strip()
            action = op.get("action", "write").strip().lower()
            content = op.get("content", "")

            if not rel_path:
                result["skipped"].append("Operazione senza path.")
                continue

            safe_target = self._safe_target_path(root, rel_path)

            if safe_target is None:
                result["errors"].append(f"Percorso non sicuro o fuori progetto: {rel_path}")
                continue

            try:
                safe_target.parent.mkdir(parents=True, exist_ok=True)

                existed = safe_target.exists()

                if action in ["write", "create", "overwrite", "update"]:
                    safe_target.write_text(content, encoding="utf-8")

                    if existed:
                        result["updated"].append(str(safe_target.relative_to(root)))
                    else:
                        result["created"].append(str(safe_target.relative_to(root)))

                elif action in ["delete", "remove"]:
                    if safe_target.exists() and safe_target.is_file():
                        safe_target.unlink()
                        result["updated"].append(f"deleted:{safe_target.relative_to(root)}")
                    else:
                        result["skipped"].append(f"File da eliminare non trovato: {rel_path}")

                else:
                    result["skipped"].append(f"Azione non supportata '{action}' per {rel_path}")

            except Exception as e:
                result["errors"].append(f"Errore su {rel_path}: {e}")

        if result["errors"]:
            result["ok"] = False

        return result

    def _safe_target_path(self, root: Path, rel_path: str) -> Optional[Path]:
        rel_path = rel_path.replace("\\", "/").strip()

        if re.match(r"^[a-zA-Z]:/", rel_path):
            return None

        if rel_path.startswith("/"):
            return None

        if ".." in Path(rel_path).parts:
            return None

        target = (root / rel_path).resolve()

        try:
            target.relative_to(root)
        except ValueError:
            return None

        return target

    def _parse_fenced_file_blocks(self, text: str) -> List[Dict[str, Any]]:
        operations: List[Dict[str, Any]] = []

        fence_pattern = re.compile(
            r"```(?P<header>[^\n`]*)\n(?P<body>.*?)```",
            re.DOTALL | re.IGNORECASE,
        )

        for match in fence_pattern.finditer(text):
            header = (match.group("header") or "").strip()
            body = match.group("body") or ""

            path = self._extract_path_from_header(header)

            if not path:
                continue

            action = self._extract_action_from_header(header) or "write"

            operations.append({
                "path": path,
                "action": action,
                "content": body.rstrip() + "\n",
                "source": "fenced",
            })

        unclosed_pattern = re.compile(
            r"```(?P<header>[^\n`]*)\n(?P<body>.*)\Z",
            re.DOTALL | re.IGNORECASE,
        )
        unclosed = unclosed_pattern.search(text)
        if unclosed:
            header = (unclosed.group("header") or "").strip()
            body = unclosed.group("body") or ""
            path = self._extract_path_from_header(header)

            if path and not any(op.get("path") == path for op in operations):
                operations.append({
                    "path": path,
                    "action": self._extract_action_from_header(header) or "write",
                    "content": body.rstrip() + "\n",
                    "source": "fenced-unclosed",
                })

        return operations

    def _extract_path_from_header(self, header: str) -> str:
        patterns = [
            r'(?:path|file|filename)\s*=\s*"([^"]+)"',
            r"(?:path|file|filename)\s*=\s*'([^']+)'",
            r"(?:path|file|filename)\s*=\s*([^\s]+)",
            r"(?:file|lococode-file)\s+([^\s]+)",
        ]

        for pattern in patterns:
            found = re.search(pattern, header, re.IGNORECASE)
            if found:
                return found.group(1).strip()

        return ""

    def _extract_action_from_header(self, header: str) -> str:
        patterns = [
            r'action\s*=\s*"([^"]+)"',
            r"action\s*=\s*'([^']+)'",
            r"action\s*=\s*([^\s]+)",
        ]

        for pattern in patterns:
            found = re.search(pattern, header, re.IGNORECASE)
            if found:
                return found.group(1).strip()

        return "write"

    def _parse_xml_file_tags(self, text: str) -> List[Dict[str, Any]]:
        operations: List[Dict[str, Any]] = []

        tag_pattern = re.compile(
            r'<file\s+path=["\'](?P<path>[^"\']+)["\'](?:\s+action=["\'](?P<action>[^"\']+)["\'])?\s*>(?P<body>.*?)</file>',
            re.DOTALL | re.IGNORECASE,
        )

        for match in tag_pattern.finditer(text):
            operations.append({
                "path": match.group("path").strip(),
                "action": (match.group("action") or "write").strip(),
                "content": (match.group("body") or "").strip() + "\n",
                "source": "xml",
            })

        return operations

    def _parse_json_blocks(self, text: str) -> List[Dict[str, Any]]:
        operations: List[Dict[str, Any]] = []

        fence_pattern = re.compile(
            r"```(?:json|lococode-json)?\s*\n(?P<body>\{.*?\})\s*```",
            re.DOTALL | re.IGNORECASE,
        )

        for match in fence_pattern.finditer(text):
            body = match.group("body")

            try:
                data = json.loads(body)
            except Exception:
                continue

            files = data.get("files")

            if not isinstance(files, list):
                continue

            for item in files:
                if not isinstance(item, dict):
                    continue

                path = str(item.get("path", "")).strip()
                content = str(item.get("content", ""))
                action = str(item.get("action", "write")).strip()

                if not path:
                    continue

                operations.append({
                    "path": path,
                    "action": action,
                    "content": content,
                    "source": "json",
                })

        return operations
