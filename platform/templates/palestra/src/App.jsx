import { useEffect, useState } from "react";
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import LoginPage from "./pages/LoginPage.jsx";
import MembersListPage from "./pages/MembersListPage.jsx";
import MemberFormPage from "./pages/MemberFormPage.jsx";
import MemberDetailPage from "./pages/MemberDetailPage.jsx";
import { mc } from "./lib/api.js";

function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!mc.accessToken) {
      setUser(null);
      setLoading(false);
      return;
    }
    try {
      const me = await mc.auth.me();
      setUser(me.user);
    } catch {
      setUser(null);
      mc.clearTokens();
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, []);

  return { user, loading, refresh };
}

function NavBar({ user, onLogout }) {
  return (
    <header className="bg-white border-b border-slate-200">
      <div className="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
        <Link to="/" className="font-bold text-lg text-brand-600">Palestra Demo</Link>
        <span className="text-xs text-slate-400 hidden sm:inline">powered by MelluCode</span>
        <div className="flex-1" />
        {user && (
          <>
            <span className="text-sm text-slate-600 hidden sm:inline">{user.email}</span>
            <button onClick={onLogout} className="btn-ghost text-sm">Esci</button>
          </>
        )}
      </div>
    </header>
  );
}

function RequireAuth({ user, loading, children }) {
  const loc = useLocation();
  if (loading) return <div className="p-8 text-slate-500">Caricamento…</div>;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();

  async function handleLogout() {
    await mc.auth.logout();
    await refresh();
    navigate("/login");
  }

  return (
    <div className="min-h-screen flex flex-col">
      <NavBar user={user} onLogout={handleLogout} />
      <main className="flex-1 max-w-5xl w-full mx-auto px-4 py-6">
        <Routes>
          <Route path="/login" element={<LoginPage onLoggedIn={refresh} />} />
          <Route path="/" element={<RequireAuth user={user} loading={loading}><MembersListPage /></RequireAuth>} />
          <Route path="/new" element={<RequireAuth user={user} loading={loading}><MemberFormPage /></RequireAuth>} />
          <Route path="/m/:id" element={<RequireAuth user={user} loading={loading}><MemberDetailPage /></RequireAuth>} />
          <Route path="/m/:id/edit" element={<RequireAuth user={user} loading={loading}><MemberFormPage /></RequireAuth>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      <footer className="text-center text-xs text-slate-400 py-4">
        Backend: <code>mellucode.mellutecno.it</code> · Stack: React + MelluCode SDK
      </footer>
    </div>
  );
}
