import { useEffect, useState } from "react";
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { LogOut, LayoutGrid, Sparkles } from "lucide-react";
import LoginPage from "./pages/LoginPage.jsx";
import EntityListPage from "./pages/EntityListPage.jsx";
import EntityFormPage from "./pages/EntityFormPage.jsx";
import EntityDetailPage from "./pages/EntityDetailPage.jsx";
import GeneratedHome from "./generated/GeneratedHome.jsx";
import GeneratedEntityList from "./generated/GeneratedEntityList.jsx";
import "./generated/generated.css";
import { mc, APP_LAYOUT, APP_NAME, entityRoute } from "./lib/api.js";
import Logo from "./components/Logo.jsx";
import PageBackground from "./components/PageBackground.jsx";
import { ToastProvider } from "./components/Toast.jsx";

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

function TopBar({ user, entities, onLogout }) {
  return (
    <header className="sticky top-0 z-30 glass border-b border-white/[0.06]">
      <div className="max-w-6xl mx-auto px-5 sm:px-8 min-h-16 py-3 flex flex-wrap lg:flex-nowrap items-center gap-4 lg:gap-6">
        <Link to="/" className="group">
          <Logo />
        </Link>
        <nav className="order-last lg:order-none w-full lg:w-auto flex items-center gap-1 overflow-x-auto pb-1 lg:pb-0 no-scrollbar">
          {(entities || []).slice(0, 8).map((entity) => (
            <Link key={entity.name} to={entityRoute(entity.name)} className="btn-ghost btn-sm shrink-0">
              <LayoutGrid className="w-3.5 h-3.5" /> {entity.label || entity.name}
            </Link>
          ))}
        </nav>
        <div className="flex-1" />
        {user && (
          <>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06]">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_currentColor]" />
              <span className="text-xs text-ink-200">{user.email}</span>
            </div>
            <button onClick={onLogout} className="btn-ghost btn-sm" title="Esci">
              <LogOut className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Esci</span>
            </button>
          </>
        )}
      </div>
    </header>
  );
}

function RequireAuth({ user, loading, children }) {
  const loc = useLocation();
  if (loading) {
    return (
      <div className="grid place-items-center py-32 text-ink-400 text-sm">
        <div className="flex items-center gap-2">
          <Sparkles className="w-4 h-4 animate-pulse text-accent-400" />
          Caricamento…
        </div>
      </div>
    );
  }
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname }} replace />;
  return children;
}

export default function App() {
  const { user, loading, refresh } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isLogin = location.pathname === "/login";
  const [entities, setEntities] = useState([]);

  useEffect(() => {
    let cancelled = false;
    if (!user) {
      setEntities([]);
      return;
    }
    mc.entities.list()
      .then((res) => {
        if (!cancelled) setEntities(res.entities || []);
      })
      .catch(() => {
        if (!cancelled) setEntities([]);
      });
    return () => { cancelled = true; };
  }, [user]);

  async function handleLogout() {
    await mc.auth.logout();
    await refresh();
    navigate("/login");
  }

  return (
    <ToastProvider>
      <PageBackground />
      <div className={`min-h-screen flex flex-col app-layout app-layout-${APP_LAYOUT}`}>
        {!isLogin && <TopBar user={user} entities={entities} onLogout={handleLogout} />}
        <main key={location.pathname} className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-8 py-8 sm:py-10 animate-rise">
          <Routes>
            <Route path="/login" element={<LoginPage onLoggedIn={refresh} />} />
            <Route path="/" element={<RequireAuth user={user} loading={loading}><GeneratedHome /></RequireAuth>} />
            <Route path="/new" element={<RequireAuth user={user} loading={loading}><EntityFormPage /></RequireAuth>} />
            <Route path="/r/:id" element={<RequireAuth user={user} loading={loading}><EntityDetailPage /></RequireAuth>} />
            <Route path="/r/:id/edit" element={<RequireAuth user={user} loading={loading}><EntityFormPage /></RequireAuth>} />
            <Route path="/e/:entityName" element={<RequireAuth user={user} loading={loading}><GeneratedEntityList /></RequireAuth>} />
            <Route path="/e/:entityName/new" element={<RequireAuth user={user} loading={loading}><EntityFormPage /></RequireAuth>} />
            <Route path="/e/:entityName/r/:id" element={<RequireAuth user={user} loading={loading}><EntityDetailPage /></RequireAuth>} />
            <Route path="/e/:entityName/r/:id/edit" element={<RequireAuth user={user} loading={loading}><EntityFormPage /></RequireAuth>} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {!isLogin && (
          <footer className="text-center text-xs text-ink-500 py-6">
            {APP_NAME} ·
            <span className="ml-1 text-gradient-accent font-medium">powered by MelluCode</span>
          </footer>
        )}
      </div>
    </ToastProvider>
  );
}
