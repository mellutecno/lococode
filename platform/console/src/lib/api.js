// Client per la Console MelluCode. NB: la Console usa JWT *creator* (mc_users),
// non app-auth — gli endpoint sono /v1/auth/* e /v1/tenants. La libreria mc.*
// dell'SDK e' pensata per app generate (app-auth), quindi qui non la usiamo
// per auth/tenants e facciamo fetch dirette via wrapper.
//
// Resta uno spazio per usare mc.* in futuro (es. quando avremo /v1/admin/* per
// fare aggregate stats e ci servisse un client comune).

const API_URL = ""; // same-origin in produzione, dev usa proxy /v1
const STORAGE_KEY = "mellucode:console";

function getStorage() {
  if (typeof window === "undefined" || !window.localStorage) {
    const mem = {};
    return {
      get: (k) => mem[k] ?? null,
      set: (k, v) => { mem[k] = v; },
      del: (k) => { delete mem[k]; },
    };
  }
  return {
    get: (k) => window.localStorage.getItem(k),
    set: (k, v) => window.localStorage.setItem(k, v),
    del: (k) => window.localStorage.removeItem(k),
  };
}
const storage = getStorage();

// ---- tokens ----
export function getAccessToken()  { return storage.get(`${STORAGE_KEY}:access`); }
export function getRefreshToken() { return storage.get(`${STORAGE_KEY}:refresh`); }
export function setTokens({ accessToken, refreshToken }) {
  if (accessToken)  storage.set(`${STORAGE_KEY}:access`, accessToken);
  if (refreshToken) storage.set(`${STORAGE_KEY}:refresh`, refreshToken);
}
export function clearTokens() {
  storage.del(`${STORAGE_KEY}:access`);
  storage.del(`${STORAGE_KEY}:refresh`);
}

// ---- core request ----
export class ApiError extends Error {
  constructor(message, { status, payload } = {}) {
    super(message);
    this.status = status;
    this.payload = payload;
  }
}

async function rawRequest(path, options = {}) {
  const { method = "GET", body, auth = true, headers = {} } = options;
  const finalHeaders = { ...headers };

  let fetchBody;
  if (body !== undefined) {
    finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
    fetchBody = JSON.stringify(body);
  }
  if (auth) {
    const token = getAccessToken();
    if (token) finalHeaders.Authorization = `Bearer ${token}`;
  }

  const res = await fetch(`${API_URL}${path}`, { method, headers: finalHeaders, body: fetchBody });

  let payload = null;
  if (res.status !== 204) {
    const text = await res.text();
    if (text) {
      try { payload = JSON.parse(text); } catch { payload = text; }
    }
  }

  if (!res.ok) {
    const msg = payload?.error || payload?.message || `Errore API (${res.status}).`;
    throw new ApiError(msg, { status: res.status, payload });
  }
  return payload;
}

// Wrapper con auto-refresh su 401: se l'access e' scaduto, prova un refresh
// usando il refresh token, salva i nuovi e ritenta UNA VOLTA. Se anche il
// refresh fallisce, pulisce e propaga l'errore.
async function request(path, options = {}) {
  try {
    return await rawRequest(path, options);
  } catch (err) {
    if (err.status !== 401 || !options.auth && options.auth !== undefined) throw err;
    const refreshToken = getRefreshToken();
    if (!refreshToken) { clearTokens(); throw err; }

    try {
      const refreshed = await rawRequest("/v1/auth/refresh", {
        method: "POST", auth: false, body: { refreshToken },
      });
      setTokens(refreshed);
    } catch {
      clearTokens();
      throw err;
    }
    return await rawRequest(path, options);
  }
}

// ---- Auth API ----
export const auth = {
  async register({ email, password, name }) {
    const r = await request("/v1/auth/register", { method: "POST", auth: false, body: { email, password, name } });
    setTokens(r);
    return r;
  },
  async login({ email, password }) {
    const r = await request("/v1/auth/login", { method: "POST", auth: false, body: { email, password } });
    setTokens(r);
    return r;
  },
  async logout() {
    const refreshToken = getRefreshToken();
    try {
      if (refreshToken) await request("/v1/auth/logout", { method: "POST", auth: false, body: { refreshToken } });
    } finally {
      clearTokens();
    }
  },
  me() {
    return request("/v1/auth/me");
  },
};

// ---- Tenants API ----
export const tenants = {
  list() {
    return request("/v1/tenants");
  },
  create(payload) {
    return request("/v1/tenants", { method: "POST", body: payload });
  },
  update(id, payload) {
    return request(`/v1/tenants/${encodeURIComponent(id)}`, { method: "PATCH", body: payload });
  },
  delete(id) {
    return request(`/v1/tenants/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  stats(id) {
    return request(`/v1/tenants/${encodeURIComponent(id)}/stats`);
  },
  generateSchema(id) {
    return request(`/v1/tenants/${encodeURIComponent(id)}/generate-schema`, { method: "POST", body: {} });
  },
};

// ---- Platform Admin API ----
export const admin = {
  users() {
    return request("/v1/admin/users");
  },
  deleteUser(id) {
    return request(`/v1/admin/users/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
  sendUserEmail(id, payload) {
    return request(`/v1/admin/users/${encodeURIComponent(id)}/email`, { method: "POST", body: payload });
  },
  tenants() {
    return request("/v1/admin/tenants");
  },
  deleteTenant(id) {
    return request(`/v1/admin/tenants/${encodeURIComponent(id)}`, { method: "DELETE" });
  },
};

// ---- Utility ----
export function tenantUrl(slug) {
  // Le app generate vivranno su /apps/{slug}/ (Fase 2). Per ora la palestra
  // demo gira su /demo/palestra/ (path custom). Mappiamo: se slug e' la demo
  // pre-seedata, manda al path corretto.
  if (slug === "palestra-demo") return "/demo/palestra/";
  return `/apps/${slug}/`;
}

export function formatDateIt(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "short", year: "numeric" });
}

export function slugifyClient(s) {
  return String(s || "")
    .trim().toLowerCase()
    .normalize("NFD").replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}
