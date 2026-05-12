from pathlib import Path
from datetime import datetime
import json


class TaskRunner:
    def __init__(self):
        pass

    def _state_path(self, project_path):
        return Path(project_path) / ".lc" / "state.json"

    def _log(self, root, name, created, skipped, overwritten=None):
        overwritten = overwritten or []

        log_dir = Path(root) / ".lc" / "logs"
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

    def _write_file(self, path, content, overwrite=True):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)

        existed = path.exists()

        if existed and not overwrite:
            return "skipped"

        path.write_text(content.strip() + "\n", encoding="utf-8")

        if existed:
            return "overwritten"

        return "created"

    def load_state(self, project_path):
        root = Path(project_path)
        state_path = self._state_path(project_path)

        if state_path.exists():
            try:
                return json.loads(state_path.read_text(encoding="utf-8"))
            except Exception:
                pass

        completed_task = 0

        if (root / "backend" / "app" / "main.py").exists() and (root / "frontend" / "src" / "App.jsx").exists():
            completed_task = 1

        if (root / "backend" / "app" / "routers" / "cards.py").exists():
            completed_task = 2

        app_file = root / "frontend" / "src" / "App.jsx"
        api_file = root / "frontend" / "src" / "services" / "api.js"

        if api_file.exists():
            completed_task = max(completed_task, 3)

        if app_file.exists():
            try:
                app_text = app_file.read_text(encoding="utf-8")
                if "Crea lista" in app_text and "Nuova card" in app_text:
                    completed_task = max(completed_task, 4)
                if "Modifica rapida" in app_text and "Sposta" in app_text:
                    completed_task = max(completed_task, 5)
                if "Accesso utente" in app_text and "Registrati" in app_text:
                    completed_task = max(completed_task, 6)
            except Exception:
                pass

        return {
            "completed_task": completed_task,
            "next_task": completed_task + 1,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

    def save_state(self, project_path, completed_task):
        state_path = self._state_path(project_path)
        state_path.parent.mkdir(parents=True, exist_ok=True)

        state = {
            "completed_task": completed_task,
            "next_task": completed_task + 1,
            "updated_at": datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        }

        state_path.write_text(json.dumps(state, indent=2), encoding="utf-8")
        return state

    def get_status_text(self, project_path):
        if not project_path:
            return "Task: nessun progetto"

        state = self.load_state(project_path)
        completed = int(state.get("completed_task", 0))
        return f"Task completato: {completed} | Prossimo: {completed + 1}"

    def execute_next_task(self, project_path):
        if not project_path:
            raise ValueError("Nessun progetto aperto.")

        state = self.load_state(project_path)
        completed = int(state.get("completed_task", 0))
        next_task = completed + 1

        if next_task == 6:
            return self._execute_task6_auth(project_path)

        return {
            "task": next_task,
            "message": f"Nessun esecutore automatico ancora disponibile per il Task {next_task}.",
            "created": [],
            "overwritten": [],
            "skipped": [],
            "log": ""
        }

    def _execute_task6_auth(self, project_path):
        root = Path(project_path)
        backend = root / "backend"
        app = backend / "app"
        frontend = root / "frontend"
        src = frontend / "src"

        if not backend.exists() or not frontend.exists():
            raise ValueError("Backend o frontend non trovati. Esegui prima i task precedenti.")

        created = []
        overwritten = []
        skipped = []

        files = {
            app / "core" / "security.py": """
import os
from datetime import datetime, timedelta

from dotenv import load_dotenv
from jose import jwt
from passlib.context import CryptContext


load_dotenv()

SECRET_KEY = os.getenv("SECRET_KEY", "change-me")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "60"))

pwd_context = CryptContext(schemes=["bcrypt"], deprecated="auto")


def verify_password(plain_password, hashed_password):
    return pwd_context.verify(plain_password, hashed_password)


def get_password_hash(password):
    return pwd_context.hash(password)


def create_access_token(data: dict):
    to_encode = data.copy()
    expire = datetime.utcnow() + timedelta(minutes=ACCESS_TOKEN_EXPIRE_MINUTES)
    to_encode.update({"exp": expire})
    return jwt.encode(to_encode, SECRET_KEY, algorithm=ALGORITHM)
""",
            app / "schemas" / "auth.py": """
from pydantic import BaseModel


class UserCreate(BaseModel):
    email: str
    password: str


class UserLogin(BaseModel):
    email: str
    password: str


class UserResponse(BaseModel):
    id: int
    email: str

    class Config:
        from_attributes = True


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse
""",
            app / "routers" / "auth.py": """
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.database import get_db
from app.models.user import User
from app.schemas.auth import TokenResponse, UserCreate, UserLogin
from app.core.security import create_access_token, get_password_hash, verify_password


router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/register", response_model=TokenResponse)
def register(payload: UserCreate, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()

    existing = db.query(User).filter(User.email == email).first()

    if existing:
        raise HTTPException(status_code=400, detail="Email già registrata")

    if len(payload.password) < 6:
        raise HTTPException(status_code=400, detail="La password deve avere almeno 6 caratteri")

    user = User(
        email=email,
        hashed_password=get_password_hash(payload.password)
    )

    db.add(user)
    db.commit()
    db.refresh(user)

    token = create_access_token({"sub": str(user.id), "email": user.email})

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }


@router.post("/login", response_model=TokenResponse)
def login(payload: UserLogin, db: Session = Depends(get_db)):
    email = payload.email.strip().lower()

    user = db.query(User).filter(User.email == email).first()

    if not user or not verify_password(payload.password, user.hashed_password):
        raise HTTPException(status_code=401, detail="Credenziali non valide")

    token = create_access_token({"sub": str(user.id), "email": user.email})

    return {
        "access_token": token,
        "token_type": "bearer",
        "user": user
    }
""",
            app / "main.py": """
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.database import Base, engine

# Import modelli per registrare le tabelle SQLAlchemy
from app.models.user import User
from app.models.board import Board
from app.models.list_model import BoardList
from app.models.card import Card

from app.routers.auth import router as auth_router
from app.routers.boards import router as boards_router
from app.routers.lists import router as lists_router
from app.routers.cards import router as cards_router


Base.metadata.create_all(bind=engine)

app = FastAPI(
    title="LocoCode Trello Backend",
    version="0.3.0"
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

app.include_router(auth_router)
app.include_router(boards_router)
app.include_router(lists_router)
app.include_router(cards_router)


@app.get("/")
def root():
    return {
        "name": "LocoCode Trello Backend",
        "status": "online",
        "version": "0.3.0"
    }


@app.get("/health")
def health():
    return {"ok": True}
""",
            src / "services" / "api.js": """
const API_URL = import.meta.env.VITE_API_URL || 'http://127.0.0.1:8000'

function getToken() {
  return localStorage.getItem('lococode_token')
}

async function request(path, options = {}) {
  const token = getToken()

  const response = await fetch(`${API_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(options.headers || {}),
    },
    ...options,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(text || `Errore HTTP ${response.status}`)
  }

  if (response.status === 204) {
    return null
  }

  return response.json()
}

export const api = {
  health() {
    return request('/health')
  },

  register(email, password) {
    return request('/auth/register', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  login(email, password) {
    return request('/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
  },

  listBoards() {
    return request('/boards/')
  },

  createBoard(title) {
    return request('/boards/', {
      method: 'POST',
      body: JSON.stringify({ title }),
    })
  },

  updateBoard(id, data) {
    return request(`/boards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  deleteBoard(id) {
    return request(`/boards/${id}`, {
      method: 'DELETE',
    })
  },

  listLists(boardId) {
    return request(`/lists/board/${boardId}`)
  },

  createList(boardId, title, order = 0) {
    return request('/lists/', {
      method: 'POST',
      body: JSON.stringify({ board_id: boardId, title, order }),
    })
  },

  updateList(id, data) {
    return request(`/lists/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  deleteList(id) {
    return request(`/lists/${id}`, {
      method: 'DELETE',
    })
  },

  listCards(listId) {
    return request(`/cards/list/${listId}`)
  },

  createCard(listId, title, order = 0) {
    return request('/cards/', {
      method: 'POST',
      body: JSON.stringify({
        list_id: listId,
        title,
        description: '',
        color_label: '',
        due_date: '',
        order,
      }),
    })
  },

  updateCard(id, data) {
    return request(`/cards/${id}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    })
  },

  deleteCard(id) {
    return request(`/cards/${id}`, {
      method: 'DELETE',
    })
  },
}
""",
            src / "App.jsx": """
import { useEffect, useState } from 'react'
import { api } from './services/api'

export default function App() {
  const [status, setStatus] = useState('Verifica backend...')
  const [user, setUser] = useState(() => {
    const raw = localStorage.getItem('lococode_user')
    return raw ? JSON.parse(raw) : null
  })
  const [authMode, setAuthMode] = useState('login')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [boards, setBoards] = useState([])
  const [selectedBoard, setSelectedBoard] = useState(null)
  const [lists, setLists] = useState([])
  const [cardsByList, setCardsByList] = useState({})
  const [boardTitle, setBoardTitle] = useState('')
  const [listTitle, setListTitle] = useState('')
  const [cardTitles, setCardTitles] = useState({})
  const [editingBoardTitle, setEditingBoardTitle] = useState('')
  const [editingListTitles, setEditingListTitles] = useState({})
  const [editingCards, setEditingCards] = useState({})
  const [error, setError] = useState('')

  async function handleAuth(event) {
    event.preventDefault()

    try {
      const result =
        authMode === 'login'
          ? await api.login(authEmail, authPassword)
          : await api.register(authEmail, authPassword)

      localStorage.setItem('lococode_token', result.access_token)
      localStorage.setItem('lococode_user', JSON.stringify(result.user))
      setUser(result.user)
      setAuthEmail('')
      setAuthPassword('')
      setError('')
      await loadBoards()
    } catch (err) {
      setError(err.message)
    }
  }

  function logout() {
    localStorage.removeItem('lococode_token')
    localStorage.removeItem('lococode_user')
    setUser(null)
    setBoards([])
    setSelectedBoard(null)
    setLists([])
    setCardsByList({})
  }

  async function loadBoards() {
    try {
      await api.health()
      const data = await api.listBoards()
      setBoards(data)
      setStatus('Backend collegato')
      setError('')

      if (!selectedBoard && data.length > 0) {
        setSelectedBoard(data[0])
      }
    } catch (err) {
      setStatus('Backend non raggiungibile')
      setError(err.message)
    }
  }

  async function loadBoardContent(board) {
    if (!board) {
      setLists([])
      setCardsByList({})
      return
    }

    try {
      const listData = await api.listLists(board.id)
      setLists(listData)

      const entries = await Promise.all(
        listData.map(async (list) => {
          const cards = await api.listCards(list.id)
          return [list.id, cards]
        })
      )

      setCardsByList(Object.fromEntries(entries))
      setError('')
    } catch (err) {
      setError(err.message)
    }
  }

  async function createBoard(event) {
    event.preventDefault()
    const cleanTitle = boardTitle.trim()
    if (!cleanTitle) return

    try {
      const board = await api.createBoard(cleanTitle)
      setBoardTitle('')
      await loadBoards()
      setSelectedBoard(board)
    } catch (err) {
      setError(err.message)
    }
  }

  async function renameSelectedBoard(event) {
    event.preventDefault()
    if (!selectedBoard) return

    const cleanTitle = editingBoardTitle.trim()
    if (!cleanTitle) return

    try {
      const updated = await api.updateBoard(selectedBoard.id, { title: cleanTitle })
      setSelectedBoard(updated)
      setEditingBoardTitle('')
      await loadBoards()
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteBoard(id) {
    try {
      await api.deleteBoard(id)

      if (selectedBoard?.id === id) {
        setSelectedBoard(null)
        setLists([])
        setCardsByList({})
      }

      await loadBoards()
    } catch (err) {
      setError(err.message)
    }
  }

  async function createList(event) {
    event.preventDefault()
    if (!selectedBoard) return

    const cleanTitle = listTitle.trim()
    if (!cleanTitle) return

    try {
      await api.createList(selectedBoard.id, cleanTitle, lists.length + 1)
      setListTitle('')
      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  async function renameList(event, list) {
    event.preventDefault()
    const cleanTitle = (editingListTitles[list.id] || '').trim()
    if (!cleanTitle) return

    try {
      await api.updateList(list.id, { title: cleanTitle })
      setEditingListTitles((current) => ({ ...current, [list.id]: '' }))
      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteList(id) {
    try {
      await api.deleteList(id)
      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  async function createCard(event, listId) {
    event.preventDefault()
    const cleanTitle = (cardTitles[listId] || '').trim()
    if (!cleanTitle) return

    try {
      const currentCards = cardsByList[listId] || []
      await api.createCard(listId, cleanTitle, currentCards.length + 1)

      setCardTitles((current) => ({ ...current, [listId]: '' }))
      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  async function updateCard(event, card) {
    event.preventDefault()
    const form = editingCards[card.id] || {}

    try {
      await api.updateCard(card.id, {
        title: form.title ?? card.title,
        description: form.description ?? card.description ?? '',
        color_label: form.color_label ?? card.color_label ?? '',
        due_date: form.due_date ?? card.due_date ?? '',
      })

      setEditingCards((current) => ({ ...current, [card.id]: undefined }))
      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  async function moveCard(card, targetListId) {
    const parsedListId = Number(targetListId)
    if (!parsedListId || parsedListId === card.list_id) return

    try {
      const targetCards = cardsByList[parsedListId] || []
      await api.updateCard(card.id, {
        list_id: parsedListId,
        order: targetCards.length + 1,
      })

      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  async function deleteCard(id) {
    try {
      await api.deleteCard(id)
      await loadBoardContent(selectedBoard)
    } catch (err) {
      setError(err.message)
    }
  }

  function updateEditingCard(cardId, field, value) {
    setEditingCards((current) => ({
      ...current,
      [cardId]: {
        ...(current[cardId] || {}),
        [field]: value,
      },
    }))
  }

  useEffect(() => {
    if (user) {
      loadBoards()
    }
  }, [user?.id])

  useEffect(() => {
    if (selectedBoard) {
      setEditingBoardTitle(selectedBoard.title)
    }

    loadBoardContent(selectedBoard)
  }, [selectedBoard?.id])

  if (!user) {
    return (
      <main className="page auth-page">
        <section className="hero">
          <p className="badge">LocoCode · Task 6</p>
          <h1>Accesso utente</h1>
          <p>
            Login e registrazione collegati al backend FastAPI con token JWT.
          </p>
          <div className="status">{status}</div>
          {error && <div className="error">{error}</div>}
        </section>

        <section className="panel auth-panel">
          <div className="tabs">
            <button
              className={authMode === 'login' ? 'active-tab' : ''}
              onClick={() => setAuthMode('login')}
            >
              Login
            </button>
            <button
              className={authMode === 'register' ? 'active-tab' : ''}
              onClick={() => setAuthMode('register')}
            >
              Registrati
            </button>
          </div>

          <form onSubmit={handleAuth} className="auth-form">
            <input
              value={authEmail}
              onChange={(event) => setAuthEmail(event.target.value)}
              placeholder="Email"
              type="email"
            />

            <input
              value={authPassword}
              onChange={(event) => setAuthPassword(event.target.value)}
              placeholder="Password"
              type="password"
            />

            <button type="submit">
              {authMode === 'login' ? 'Entra' : 'Crea account'}
            </button>
          </form>
        </section>
      </main>
    )
  }

  return (
    <main className="page">
      <section className="hero">
        <p className="badge">LocoCode · Task 6</p>
        <h1>Trello-like workspace</h1>
        <p>
          Board, liste e card con autenticazione base JWT.
        </p>
        <div className="status">{status}</div>
        <div className="user-box">
          <span>Utente: {user.email}</span>
          <button onClick={logout}>Logout</button>
        </div>
        {error && <div className="error">{error}</div>}
      </section>

      <section className="panel">
        <div className="panel-header">
          <div>
            <h2>Bacheche</h2>
            <p>Crea, seleziona, rinomina ed elimina board.</p>
          </div>

          <button onClick={loadBoards}>Aggiorna</button>
        </div>

        <form onSubmit={createBoard} className="create-form">
          <input
            value={boardTitle}
            onChange={(event) => setBoardTitle(event.target.value)}
            placeholder="Nome nuova bacheca"
          />
          <button type="submit">Crea bacheca</button>
        </form>

        <div className="boards-row">
          {boards.length === 0 && <div className="empty">Nessuna bacheca ancora presente.</div>}

          {boards.map((board) => (
            <article
              className={`board-pill ${selectedBoard?.id === board.id ? 'active' : ''}`}
              key={board.id}
              onClick={() => setSelectedBoard(board)}
            >
              <div>
                <span>#{board.id}</span>
                <strong>{board.title}</strong>
              </div>

              <button
                className="danger small"
                onClick={(event) => {
                  event.stopPropagation()
                  deleteBoard(board.id)
                }}
              >
                Elimina
              </button>
            </article>
          ))}
        </div>
      </section>

      <section className="board-area">
        <div className="board-header">
          <div>
            <h2>{selectedBoard ? selectedBoard.title : 'Nessuna board selezionata'}</h2>
            <p>Modifica rapida di board, liste e card. Sposta le card tra liste.</p>
          </div>

          {selectedBoard && (
            <form onSubmit={renameSelectedBoard} className="inline-form">
              <input
                value={editingBoardTitle}
                onChange={(event) => setEditingBoardTitle(event.target.value)}
                placeholder="Rinomina board"
              />
              <button type="submit">Rinomina</button>
            </form>
          )}
        </div>

        {selectedBoard && (
          <form onSubmit={createList} className="create-form compact">
            <input
              value={listTitle}
              onChange={(event) => setListTitle(event.target.value)}
              placeholder="Nome nuova lista"
            />
            <button type="submit">Crea lista</button>
          </form>
        )}

        {!selectedBoard && <div className="empty">Crea o seleziona una bacheca per iniziare.</div>}

        {selectedBoard && (
          <div className="lists-row">
            {lists.length === 0 && (
              <div className="empty">Nessuna lista ancora presente in questa bacheca.</div>
            )}

            {lists.map((list) => (
              <section className="list-column" key={list.id}>
                <div className="list-header">
                  <div>
                    <span>#{list.id}</span>
                    <h3>{list.title}</h3>
                  </div>

                  <button className="danger small" onClick={() => deleteList(list.id)}>
                    Elimina
                  </button>
                </div>

                <form onSubmit={(event) => renameList(event, list)} className="mini-form">
                  <input
                    value={editingListTitles[list.id] || ''}
                    onChange={(event) =>
                      setEditingListTitles((current) => ({
                        ...current,
                        [list.id]: event.target.value,
                      }))
                    }
                    placeholder="Rinomina lista"
                  />
                  <button type="submit">OK</button>
                </form>

                <div className="cards">
                  {(cardsByList[list.id] || []).map((card) => {
                    const edit = editingCards[card.id] || {}

                    return (
                      <article className="card" key={card.id}>
                        <form onSubmit={(event) => updateCard(event, card)} className="card-edit">
                          <input
                            value={edit.title ?? card.title}
                            onChange={(event) => updateEditingCard(card.id, 'title', event.target.value)}
                            placeholder="Titolo card"
                          />

                          <textarea
                            value={edit.description ?? card.description ?? ''}
                            onChange={(event) => updateEditingCard(card.id, 'description', event.target.value)}
                            placeholder="Descrizione"
                          />

                          <div className="card-actions">
                            <select
                              value={card.list_id}
                              onChange={(event) => moveCard(card, event.target.value)}
                            >
                              {lists.map((targetList) => (
                                <option key={targetList.id} value={targetList.id}>
                                  Sposta in: {targetList.title}
                                </option>
                              ))}
                            </select>

                            <button type="submit">Salva</button>
                            <button type="button" className="danger tiny" onClick={() => deleteCard(card.id)}>
                              Elimina
                            </button>
                          </div>
                        </form>
                      </article>
                    )
                  })}
                </div>

                <form onSubmit={(event) => createCard(event, list.id)} className="card-form">
                  <input
                    value={cardTitles[list.id] || ''}
                    onChange={(event) =>
                      setCardTitles((current) => ({
                        ...current,
                        [list.id]: event.target.value,
                      }))
                    }
                    placeholder="Nuova card"
                  />
                  <button type="submit">Aggiungi</button>
                </form>
              </section>
            ))}
          </div>
        )}
      </section>
    </main>
  )
}
""",
            src / "index.css": """
* {
  box-sizing: border-box;
}

body {
  margin: 0;
  background: #0f1117;
  color: white;
  font-family: Arial, sans-serif;
}

button,
input,
textarea,
select {
  font: inherit;
}

.page {
  width: min(1440px, calc(100% - 32px));
  margin: 0 auto;
  padding: 32px 0;
}

.auth-page {
  width: min(760px, calc(100% - 32px));
}

.hero {
  padding: 32px;
  border-radius: 24px;
  background:
    radial-gradient(circle at top left, rgba(37, 99, 235, 0.38), transparent 30%),
    linear-gradient(135deg, #151925, #111827);
  border: 1px solid #2c3344;
  margin-bottom: 24px;
}

.badge {
  display: inline-block;
  padding: 8px 12px;
  background: #2563eb;
  color: white;
  border-radius: 999px;
  font-size: 14px;
}

h1 {
  font-size: clamp(34px, 5vw, 60px);
  margin: 18px 0 12px;
}

h2,
h3,
p {
  margin-top: 0;
}

p {
  color: #cbd5e1;
  line-height: 1.6;
}

.status,
.error,
.user-box {
  display: inline-flex;
  gap: 12px;
  align-items: center;
  margin-top: 18px;
  padding: 10px 14px;
  border-radius: 12px;
  background: #101827;
  border: 1px solid #334155;
}

.error {
  display: block;
  color: #fecaca;
  border-color: #7f1d1d;
  background: #451a1a;
  max-width: 900px;
}

.panel,
.board-area {
  padding: 22px;
  border-radius: 22px;
  background: #151925;
  border: 1px solid #2c3344;
  margin-bottom: 24px;
}

.auth-panel {
  max-width: 520px;
  margin: 0 auto;
}

.tabs {
  display: flex;
  gap: 10px;
  margin-bottom: 18px;
}

.active-tab {
  background: #1d4ed8;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
}

.auth-form {
  display: grid;
  gap: 12px;
}

.panel-header,
.board-header {
  display: flex;
  justify-content: space-between;
  gap: 20px;
  align-items: flex-start;
  margin-bottom: 18px;
}

.create-form,
.inline-form,
.card-form,
.mini-form {
  display: flex;
  gap: 10px;
}

.create-form {
  margin-bottom: 18px;
}

.create-form.compact {
  max-width: 640px;
}

input,
textarea,
select {
  flex: 1;
  min-width: 0;
  border: 1px solid #334155;
  background: #0f1117;
  color: white;
  padding: 12px;
  border-radius: 14px;
  outline: none;
}

textarea {
  resize: vertical;
  min-height: 74px;
}

button {
  border: 0;
  border-radius: 14px;
  background: #2563eb;
  color: white;
  padding: 12px 18px;
  cursor: pointer;
  white-space: nowrap;
}

button:hover {
  background: #1d4ed8;
}

.boards-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
}

.board-pill,
.empty {
  padding: 16px;
  border-radius: 18px;
  background: #0f1117;
  border: 1px solid #334155;
}

.board-pill {
  display: flex;
  gap: 16px;
  align-items: center;
  cursor: pointer;
}

.board-pill.active {
  border-color: #60a5fa;
  box-shadow: 0 0 0 2px rgba(96, 165, 250, 0.2);
}

.board-pill span,
.list-header span {
  color: #93c5fd;
  font-size: 13px;
  display: block;
  margin-bottom: 4px;
}

.danger {
  background: #7f1d1d;
}

.danger:hover {
  background: #991b1b;
}

.small {
  padding: 8px 12px;
  border-radius: 10px;
}

.tiny {
  padding: 8px 10px;
  border-radius: 10px;
}

.empty {
  color: #94a3b8;
}

.lists-row {
  display: flex;
  gap: 16px;
  overflow-x: auto;
  padding-bottom: 10px;
}

.list-column {
  min-width: 330px;
  max-width: 360px;
  padding: 14px;
  border-radius: 18px;
  background: #0f1117;
  border: 1px solid #334155;
}

.list-header {
  display: flex;
  justify-content: space-between;
  gap: 12px;
  align-items: flex-start;
  margin-bottom: 12px;
}

.list-header h3 {
  margin: 0;
}

.mini-form {
  margin-bottom: 12px;
}

.cards {
  display: grid;
  gap: 12px;
  margin-bottom: 12px;
}

.card {
  padding: 12px;
  border-radius: 16px;
  background: #151925;
  border: 1px solid #2c3344;
}

.card-edit {
  display: grid;
  gap: 10px;
}

.card-actions {
  display: flex;
  gap: 8px;
  align-items: center;
}

.card-actions select {
  min-width: 0;
}

.card-form {
  align-items: center;
}

.card-form button {
  padding-inline: 12px;
}
""",
        }

        for path, content in files.items():
            result = self._write_file(path, content, overwrite=True)

            if result == "created":
                created.append(str(path))
            elif result == "overwritten":
                overwritten.append(str(path))
            else:
                skipped.append(str(path))

        state = self.save_state(project_path, completed_task=6)
        log_file = self._log(root, "task6_auth.log", created, skipped, overwritten)

        return {
            "task": 6,
            "message": "Task 6 completato: login e registrazione JWT aggiunti.",
            "created": created,
            "overwritten": overwritten,
            "skipped": skipped,
            "log": log_file,
            "state": state
        }
