import { useEffect, useState } from "react";
import { Routes, Route, Link, Navigate, useNavigate, useLocation } from "react-router-dom";
import { LogOut, LayoutGrid, Loader2, Shield } from "lucide-react";
import { auth, getAccessToken, clearTokens } from "./lib/api.js";
import Logo from "./components/Logo.jsx";
import PageBackground from "./components/PageBackground.jsx";
import { ToastProvider } from "./components/Toast.jsx";

import LoginPage from "./pages/LoginPage.jsx";
import AppsDashboardPage from "./pages/AppsDashboardPage.jsx";
import AppDetailPage from "./pages/AppDetailPage.jsx";
import AdminPage from "./pages/AdminPage.jsx";

function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    if (!getAccessToken()) {
      setUser(null); setLoading(false); return;
    }
    try {
      const me = await auth.me();
      setUser(me.user);
    } catch {
      setUser(null); clearTokens();
    } finally {
      setLoading(false);
    }
  }
  useEffect(() => { refresh(); }, []);
  return { user, loading, refresh };
}

function TopBar({ user, onLogout }) {
  return (
    <header className="sticky top-0 z-30 glass border-b border-white/[0.06]">
      <div className="max-w-6xl mx-auto px-4 sm:px-8 min-h-16 py-3 flex flex-wrap sm:flex-nowrap items-center gap-3 sm:gap-5">
        <Link to="/" className="group transition hover:opacity-90">
          <Logo />
        </Link>
        <span className="hidden sm:inline pill-accent !text-[10px] uppercase tracking-wider">
          Console
        </span>
        <nav className="order-3 sm:order-none w-full sm:w-auto flex items-center gap-1 sm:ml-2 overflow-x-auto no-scrollbar pt-2 sm:pt-0 border-t sm:border-t-0 border-white/[0.06]">
          <Link to="/" className="btn-ghost btn-sm">
            <LayoutGrid className="w-3.5 h-3.5" /> Le tue app
          </Link>
          {user?.role === "admin" && (
            <Link to="/admin" className="btn-ghost btn-sm">
              <Shield className="w-3.5 h-3.5" /> Admin
            </Link>
          )}
        </nav>
        <div className="flex-1" />
        {user && (
          <>
            <div className="hidden sm:flex items-center gap-2 px-3 py-1.5 rounded-full bg-white/[0.04] border border-white/[0.06] min-w-0">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_currentColor]" />
              <span className="text-xs text-zinc-300 truncate max-w-[120px] lg:max-w-[180px]">{user.email}</span>
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
      <div className="grid place-items-center py-32 text-zinc-500 text-sm">
        <div className="flex items-center gap-2">
          <Loader2 className="w-4 h-4 animate-spin text-accent-400" />
          Carico la sessione…
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

  async function handleLogout() {
    await auth.logout();
    await refresh();
    navigate("/login");
  }

  return (
    <ToastProvider>
      <PageBackground />
      <div className="min-h-screen flex flex-col">
        {!isLogin && <TopBar user={user} onLogout={handleLogout} />}
        <main
          key={location.pathname}
          className="flex-1 max-w-6xl w-full mx-auto px-5 sm:px-8 py-8 sm:py-10 animate-rise"
        >
          <Routes>
            <Route path="/login" element={<LoginPage onLoggedIn={refresh} />} />
            <Route path="/" element={
              <RequireAuth user={user} loading={loading}>
                <AppsDashboardPage user={user} />
              </RequireAuth>
            } />
            <Route path="/app/:slug" element={
              <RequireAuth user={user} loading={loading}>
                <AppDetailPage />
              </RequireAuth>
            } />
            <Route path="/admin" element={
              <RequireAuth user={user} loading={loading}>
                <AdminPage user={user} />
              </RequireAuth>
            } />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </main>
        {!isLogin && (
          <footer className="text-center text-xs text-zinc-500 py-6">
            <span className="text-gradient-accent font-medium">MelluCode</span>
            {" - "}crea, prova e gestisci le tue app web da un unico posto.
          </footer>
        )}
      </div>
    </ToastProvider>
  );
}
