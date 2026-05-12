from pathlib import Path
from datetime import datetime


class ProjectBuilder:
    def __init__(self):
        pass

    def write_file(self, path, content, overwrite=False):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        if path.exists() and not overwrite:
            return False

        path.write_text(content.strip() + "\n", encoding="utf-8")
        return True

    def _log(self, root, name, created, skipped, overwritten=None):
        overwritten = overwritten or []
        log_dir = root / ".lc" / "logs"
        log_dir.mkdir(parents=True, exist_ok=True)

        log_file = log_dir / name
        log_file.write_text(
            f"{name} eseguito da LocoCode\n"
            f"Data: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}\n\n"
            "Creati:\n"
            + "\n".join(created)
            + "\n\nSovrascritti:\n"
            + "\n".join(overwritten)
            + "\n\nSaltati perché già esistenti:\n"
            + "\n".join(skipped)
            + "\n",
            encoding="utf-8"
        )
        return str(log_file)

    def create_task1_structure(self, project_path):
        if not project_path:
            raise ValueError("Nessun progetto aperto.")

        root = Path(project_path)

        created = []
        skipped = []

        folders = [
            root / "backend",
            root / "backend" / "app",
            root / "backend" / "app" / "core",
            root / "backend" / "app" / "models",
            root / "backend" / "app" / "schemas",
            root / "backend" / "app" / "routers",
            root / "frontend",
            root / "frontend" / "public",
            root / "frontend" / "src",
            root / "frontend" / "src" / "components",
            root / "frontend" / "src" / "pages",
            root / "frontend" / "src" / "services",
            root / "frontend" / "src" / "context",
        ]

        for folder in folders:
            folder.mkdir(parents=True, exist_ok=True)

        files = {
            root / ".gitignore": """
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

# LocoCode
.lc/tmp/

# OS
.DS_Store
Thumbs.db
""",
            root / "README.md": """
# Progetto generato con LocoCode

Questo progetto è una base full-stack pensata per:

- Frontend React + Vite
- Backend FastAPI
- Database iniziale SQLite
- Deploy su Render

## Backend locale

```powershell
cd backend
python -m venv venv
.\\venv\\Scripts\\activate
pip install -r requirements.txt
python -m uvicorn app.main:app --reload
```

## Frontend locale

```powershell
cd frontend
npm install
npm run dev
```

## Render

Il file `render.yaml` contiene una configurazione iniziale per deploy backend.
""",
            root / "render.yaml": """
services:
  - type: web
    name: lococode-backend
    env: python
    plan: free
    rootDir: backend
    buildCommand: pip install -r requirements.txt
    startCommand: uvicorn app.main:app --host 0.0.0.0 --port $PORT
    envVars:
      - key: DATABASE_URL
        value: sqlite:///./app.db
      - key: SECRET_KEY
        generateValue: true
      - key: FRONTEND_URL
        value: http://localhost:5173
""",
            root / "backend" / "requirements.txt": """
fastapi
uvicorn[standard]
sqlalchemy
pydantic
python-dotenv
python-jose[cryptography]
passlib[bcrypt]
python-multipart
alembic
""",
            root / "backend" / ".env.example": """
APP_NAME=LocoCode App
DATABASE_URL=sqlite:///./app.db
SECRET_KEY=change-me
ALGORITHM=HS256
ACCESS_TOKEN_EXPIRE_MINUTES=60
FRONTEND_URL=http://localhost:5173
""",
            root / "backend" / "app" / "__init__.py": "",
            root / "backend" / "app" / "main.py": """
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="LocoCode Backend",
    version="0.1.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/")
def root():
    return {
        "name": "LocoCode Backend",
        "status": "online"
    }


@app.get("/health")
def health():
    return {"ok": True}
""",
            root / "backend" / "app" / "database.py": """
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

load_dotenv()

DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./app.db")

connect_args = {}

if DATABASE_URL.startswith("sqlite"):
    connect_args = {"check_same_thread": False}

engine = create_engine(DATABASE_URL, connect_args=connect_args)

SessionLocal = sessionmaker(
    autocommit=False,
    autoflush=False,
    bind=engine
)

Base = declarative_base()


def get_db():
    db = SessionLocal()

    try:
        yield db
    finally:
        db.close()
""",
            root / "backend" / "app" / "core" / "__init__.py": "",
            root / "backend" / "app" / "models" / "__init__.py": "",
            root / "backend" / "app" / "schemas" / "__init__.py": "",
            root / "backend" / "app" / "routers" / "__init__.py": "",
            root / "frontend" / ".env.example": """
VITE_API_URL=http://127.0.0.1:8000
""",
            root / "frontend" / "package.json": """
{
  "name": "lococode-frontend",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "preview": "vite preview"
  },
  "dependencies": {
    "@vitejs/plugin-react": "latest",
    "vite": "latest",
    "react": "latest",
    "react-dom": "latest",
    "react-router-dom": "latest",
    "axios": "latest",
    "@tanstack/react-query": "latest",
    "@dnd-kit/core": "latest",
    "@dnd-kit/sortable": "latest",
    "@dnd-kit/utilities": "latest"
  },
  "devDependencies": {}
}
""",
            root / "frontend" / "index.html": """
<!doctype html>
<html lang="it">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>LocoCode App</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
""",
            root / "frontend" / "src" / "main.jsx": """
import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.jsx'
import './index.css'

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
)
""",
            root / "frontend" / "src" / "App.jsx": """
import { useEffect, useState } from 'react'

const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

export default function App() {
  const [status, setStatus] = useState('Verifica backend...')

  useEffect(() => {
    fetch(`${API_URL}/health`)
      .then((response) => response.json())
      .then(() => setStatus('Backend collegato'))
      .catch(() => setStatus('Backend non raggiungibile'))
  }, [])

  return (
    <main className="page">
      <section className="hero">
        <p className="badge">LocoCode</p>
        <h1>Base progetto pronta</h1>
        <p>
          Struttura iniziale React + Vite, FastAPI, SQLite e Render generata correttamente.
        </p>
        <div className="status">{status}</div>
      </section>
    </main>
  )
}
""",
            root / "frontend" / "src" / "index.css": """
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0f1117;
  color: white;
  font-family: Arial, sans-serif;
}

.page {
  width: min(1100px, calc(100% - 32px));
  margin: 0 auto;
  padding: 48px 0;
}

.hero {
  padding: 40px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.35), transparent 30%),
    linear-gradient(135deg, #151925, #111827);
  border: 1px solid #2c3344;
}

.badge {
  display: inline-block;
  padding: 8px 12px;
  background: #2563eb;
  color: white;
  border-radius: 999px;
}

h1 {
  font-size: clamp(36px, 6vw, 64px);
  margin: 18px 0 12px;
}

p {
  color: #cbd5e1;
  line-height: 1.6;
}

.status {
  display: inline-block;
  margin-top: 18px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #101827;
  border: 1px solid #334155;
}
""",
        }

        for path, content in files.items():
            written = self.write_file(path, content, overwrite=False)
            if written:
                created.append(str(path))
            else:
                skipped.append(str(path))

        log_file = self._log(root, "task1_structure.log", created, skipped)

        return {
            "created": created,
            "skipped": skipped,
            "log": log_file
        }

    def create_task2_data_model(self, project_path):
        if not project_path:
            raise ValueError("Nessun progetto aperto.")

        root = Path(project_path)
        backend = root / "backend"
        app = backend / "app"

        if not backend.exists():
            raise ValueError("Backend non trovato. Esegui prima Crea Task 1.")

        created = []
        skipped = []
        overwritten = []

        for folder in [app / "models", app / "schemas", app / "routers"]:
            folder.mkdir(parents=True, exist_ok=True)

        files_no_overwrite = {
            app / "models" / "__init__.py": """
from app.models.user import User
from app.models.board import Board
from app.models.list_model import BoardList
from app.models.card import Card
""",
            app / "models" / "user.py": """
from datetime import datetime

from sqlalchemy import Column, DateTime, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class User(Base):
    __tablename__ = "users"

    id = Column(Integer, primary_key=True, index=True)
    email = Column(String, unique=True, index=True, nullable=False)
    hashed_password = Column(String, nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    boards = relationship("Board", back_populates="owner", cascade="all, delete-orphan")
""",
            app / "models" / "board.py": """
from datetime import datetime

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class Board(Base):
    __tablename__ = "boards"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, index=True, nullable=False)
    owner_id = Column(Integer, ForeignKey("users.id"), nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    owner = relationship("User", back_populates="boards")
    lists = relationship("BoardList", back_populates="board", cascade="all, delete-orphan")
""",
            app / "models" / "list_model.py": """
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String
from sqlalchemy.orm import relationship

from app.database import Base


class BoardList(Base):
    __tablename__ = "lists"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    order = Column(Float, default=0)
    board_id = Column(Integer, ForeignKey("boards.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)

    board = relationship("Board", back_populates="lists")
    cards = relationship("Card", back_populates="list", cascade="all, delete-orphan")
""",
            app / "models" / "card.py": """
from datetime import datetime

from sqlalchemy import Column, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import relationship

from app.database import Base


class Card(Base):
    __tablename__ = "cards"

    id = Column(Integer, primary_key=True, index=True)
    title = Column(String, nullable=False)
    description = Column(Text, default="")
    color_label = Column(String, default="")
    due_date = Column(String, default="")
    order = Column(Float, default=0)
    list_id = Column(Integer, ForeignKey("lists.id"), nullable=False)
    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow)

    list = relationship("BoardList", back_populates="cards")
""",
            app / "schemas" / "__init__.py": "",
            app / "schemas" / "board.py": """
from pydantic import BaseModel


class BoardBase(BaseModel):
    title: str


class BoardCreate(BoardBase):
    pass


class BoardUpdate(BaseModel):
    title: str | None = None


class BoardResponse(BoardBase):
    id: int

    class Config:
        from_attributes = True
""",
            app / "schemas" / "list_schema.py": """
from pydantic import BaseModel


class ListBase(BaseModel):
    title: str
    order: float = 0


class ListCreate(ListBase):
    board_id: int


class ListUpdate(BaseModel):
    title: str | None = None
    order: float | None = None


class ListResponse(ListBase):
    id: int
    board_id: int

    class Config:
        from_attributes = True
""",
            app / "schemas" / "card.py": """
from pydantic import BaseModel


class CardBase(BaseModel):
    title: str
    description: str = ""
    color_label: str = ""
    due_date: str = ""
    order: float = 0


class CardCreate(CardBase):
    list_id: int


class CardUpdate(BaseModel):
    title: str | None = None
    description: str | None = None
    color_label: str | None = None
    due_date: str | None = None
    order: float | None = None
    list_id: int | None = None


class CardResponse(CardBase):
    id: int
    list_id: int

    class Config:
        from_attributes = True
""",
            app / "routers" / "__init__.py": "",
            app / "routers" / "boards.py": """
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.board import Board
from app.schemas.board import BoardCreate, BoardResponse, BoardUpdate


router = APIRouter(prefix="/boards", tags=["boards"])


@router.get("/", response_model=list[BoardResponse])
def list_boards(db: Session = Depends(get_db)):
    return db.query(Board).order_by(Board.id.desc()).all()


@router.post("/", response_model=BoardResponse)
def create_board(payload: BoardCreate, db: Session = Depends(get_db)):
    board = Board(title=payload.title)
    db.add(board)
    db.commit()
    db.refresh(board)
    return board


@router.put("/{board_id}", response_model=BoardResponse)
def update_board(board_id: int, payload: BoardUpdate, db: Session = Depends(get_db)):
    board = db.query(Board).filter(Board.id == board_id).first()

    if not board:
        raise HTTPException(status_code=404, detail="Board non trovata")

    data = payload.model_dump(exclude_unset=True)

    for key, value in data.items():
        setattr(board, key, value)

    db.commit()
    db.refresh(board)
    return board


@router.delete("/{board_id}")
def delete_board(board_id: int, db: Session = Depends(get_db)):
    board = db.query(Board).filter(Board.id == board_id).first()

    if not board:
        raise HTTPException(status_code=404, detail="Board non trovata")

    db.delete(board)
    db.commit()
    return {"ok": True}
""",
            app / "routers" / "lists.py": """
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.board import Board
from app.models.list_model import BoardList
from app.schemas.list_schema import ListCreate, ListResponse, ListUpdate


router = APIRouter(prefix="/lists", tags=["lists"])


@router.get("/board/{board_id}", response_model=list[ListResponse])
def list_lists(board_id: int, db: Session = Depends(get_db)):
    return (
        db.query(BoardList)
        .filter(BoardList.board_id == board_id)
        .order_by(BoardList.order.asc(), BoardList.id.asc())
        .all()
    )


@router.post("/", response_model=ListResponse)
def create_list(payload: ListCreate, db: Session = Depends(get_db)):
    board = db.query(Board).filter(Board.id == payload.board_id).first()

    if not board:
        raise HTTPException(status_code=404, detail="Board non trovata")

    item = BoardList(
        title=payload.title,
        board_id=payload.board_id,
        order=payload.order
    )

    db.add(item)
    db.commit()
    db.refresh(item)
    return item


@router.put("/{list_id}", response_model=ListResponse)
def update_list(list_id: int, payload: ListUpdate, db: Session = Depends(get_db)):
    item = db.query(BoardList).filter(BoardList.id == list_id).first()

    if not item:
        raise HTTPException(status_code=404, detail="Lista non trovata")

    data = payload.model_dump(exclude_unset=True)

    for key, value in data.items():
        setattr(item, key, value)

    db.commit()
    db.refresh(item)
    return item


@router.delete("/{list_id}")
def delete_list(list_id: int, db: Session = Depends(get_db)):
    item = db.query(BoardList).filter(BoardList.id == list_id).first()

    if not item:
        raise HTTPException(status_code=404, detail="Lista non trovata")

    db.delete(item)
    db.commit()
    return {"ok": True}
""",
            app / "routers" / "cards.py": """
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.card import Card
from app.models.list_model import BoardList
from app.schemas.card import CardCreate, CardResponse, CardUpdate


router = APIRouter(prefix="/cards", tags=["cards"])


@router.get("/list/{list_id}", response_model=list[CardResponse])
def list_cards(list_id: int, db: Session = Depends(get_db)):
    return (
        db.query(Card)
        .filter(Card.list_id == list_id)
        .order_by(Card.order.asc(), Card.id.asc())
        .all()
    )


@router.post("/", response_model=CardResponse)
def create_card(payload: CardCreate, db: Session = Depends(get_db)):
    board_list = db.query(BoardList).filter(BoardList.id == payload.list_id).first()

    if not board_list:
        raise HTTPException(status_code=404, detail="Lista non trovata")

    card = Card(
        title=payload.title,
        description=payload.description,
        color_label=payload.color_label,
        due_date=payload.due_date,
        order=payload.order,
        list_id=payload.list_id
    )

    db.add(card)
    db.commit()
    db.refresh(card)
    return card


@router.put("/{card_id}", response_model=CardResponse)
def update_card(card_id: int, payload: CardUpdate, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Card non trovata")

    data = payload.model_dump(exclude_unset=True)

    for key, value in data.items():
        setattr(card, key, value)

    db.commit()
    db.refresh(card)
    return card


@router.delete("/{card_id}")
def delete_card(card_id: int, db: Session = Depends(get_db)):
    card = db.query(Card).filter(Card.id == card_id).first()

    if not card:
        raise HTTPException(status_code=404, detail="Card non trovata")

    db.delete(card)
    db.commit()
    return {"ok": True}
""",
        }

        files_overwrite = {
            app / "main.py": """
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine

# Import modelli per registrare le tabelle SQLAlchemy
from app.models.user import User
from app.models.board import Board
from app.models.list_model import BoardList
from app.models.card import Card

from app.routers.boards import router as boards_router
from app.routers.lists import router as lists_router
from app.routers.cards import router as cards_router


Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="LocoCode Trello Backend",
    version="0.2.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "http://localhost:5173",
        "http://127.0.0.1:5173"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(boards_router)
app.include_router(lists_router)
app.include_router(cards_router)


@app.get("/")
def root():
    return {
        "name": "LocoCode Trello Backend",
        "status": "online",
        "version": "0.2.0"
    }


@app.get("/health")
def health():
    return {"ok": True}
"""
        }

        for path, content in files_no_overwrite.items():
            written = self.write_file(path, content, overwrite=False)
            if written:
                created.append(str(path))
            else:
                skipped.append(str(path))

        for path, content in files_overwrite.items():
            existed = path.exists()
            written = self.write_file(path, content, overwrite=True)
            if written and existed:
                overwritten.append(str(path))
            elif written:
                created.append(str(path))
            else:
                skipped.append(str(path))

        log_file = self._log(root, "task2_data_model.log", created, skipped, overwritten)

        return {
            "created": created,
            "skipped": skipped,
            "overwritten": overwritten,
            "log": log_file
        }
