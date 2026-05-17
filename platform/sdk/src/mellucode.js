import { MelluCodeError } from "./mellucode-error.js";
import { createDefaultStorage } from "./storage.js";

function trimSlash(value) {
  return String(value || "").replace(/\/+$/, "");
}

function cleanPath(path) {
  return String(path || "").startsWith("/") ? path : `/${path}`;
}

function encodeQuery(params = {}) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && value !== "") {
      search.set(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : "";
}

async function parseResponse(response) {
  if (response.status === 204) return null;
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function entityName(value) {
  const name = String(value || "").trim();
  if (!name) throw new MelluCodeError("Nome entita' mancante.");
  return encodeURIComponent(name);
}

export class MelluCode {
  constructor(options = {}) {
    const {
      apiUrl = "/",
      tenantSlug,
      storage = createDefaultStorage(),
      fetchImpl = globalThis.fetch?.bind(globalThis),
      accessToken = null,
      refreshToken = null,
    } = options;

    if (!tenantSlug) throw new MelluCodeError("tenantSlug e' obbligatorio.");
    if (!fetchImpl) throw new MelluCodeError("fetch non disponibile in questo ambiente.");

    this.apiUrl = trimSlash(apiUrl);
    this.tenantSlug = tenantSlug;
    this.storage = storage;
    this.fetch = fetchImpl;
    this.storagePrefix = `mellucode:${tenantSlug}`;

    if (accessToken || refreshToken) {
      this.setTokens({ accessToken, refreshToken });
    }

    this.auth = new AuthClient(this);
    this.entities = new EntitiesClient(this);
  }

  data(entity) {
    return new DataCollection(this, entity);
  }

  get accessToken() {
    return this.storage.getItem(`${this.storagePrefix}:accessToken`);
  }

  get refreshToken() {
    return this.storage.getItem(`${this.storagePrefix}:refreshToken`);
  }

  setTokens({ accessToken, refreshToken }) {
    if (accessToken) this.storage.setItem(`${this.storagePrefix}:accessToken`, accessToken);
    if (refreshToken) this.storage.setItem(`${this.storagePrefix}:refreshToken`, refreshToken);
  }

  clearTokens() {
    this.storage.removeItem(`${this.storagePrefix}:accessToken`);
    this.storage.removeItem(`${this.storagePrefix}:refreshToken`);
  }

  async request(path, options = {}) {
    return this.#request(path, options);
  }

  async #request(path, options = {}) {
    const {
      method = "GET",
      body,
      auth = true,
      retryOnUnauthorized = true,
      headers = {},
    } = options;

    const finalHeaders = {
      "X-Tenant-Slug": this.tenantSlug,
      ...headers,
    };

    if (body !== undefined) finalHeaders["Content-Type"] = "application/json";
    if (auth && this.accessToken) finalHeaders.Authorization = `Bearer ${this.accessToken}`;

    const response = await this.fetch(`${this.apiUrl}${cleanPath(path)}`, {
      method,
      headers: finalHeaders,
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    if (response.status === 401 && auth && retryOnUnauthorized && this.refreshToken) {
      try {
        await this.auth.refresh();
        return this.#request(path, { ...options, retryOnUnauthorized: false });
      } catch {
        this.clearTokens();
      }
    }

    const payload = await parseResponse(response);
    if (!response.ok) {
      const message = payload?.error || payload?.message || `Errore MelluCode API (${response.status}).`;
      throw new MelluCodeError(message, { status: response.status, payload });
    }

    return payload;
  }
}

class AuthClient {
  constructor(client) {
    this.client = client;
  }

  async register({ email, password, name } = {}) {
    const payload = await this.client.request("/v1/app-auth/register", {
      method: "POST",
      auth: false,
      body: {
        tenantSlug: this.client.tenantSlug,
        email,
        password,
        name,
      },
    });
    this.client.setTokens(payload);
    return payload;
  }

  async login({ email, password } = {}) {
    const payload = await this.client.request("/v1/app-auth/login", {
      method: "POST",
      auth: false,
      body: {
        tenantSlug: this.client.tenantSlug,
        email,
        password,
      },
    });
    this.client.setTokens(payload);
    return payload;
  }

  async refresh() {
    const refreshToken = this.client.refreshToken;
    if (!refreshToken) throw new MelluCodeError("Refresh token mancante.", { status: 401 });

    const payload = await this.client.request("/v1/app-auth/refresh", {
      method: "POST",
      auth: false,
      retryOnUnauthorized: false,
      body: {
        tenantSlug: this.client.tenantSlug,
        refreshToken,
      },
    });
    this.client.setTokens(payload);
    return payload;
  }

  async logout() {
    const refreshToken = this.client.refreshToken;
    try {
      if (refreshToken) {
        await this.client.request("/v1/app-auth/logout", {
          method: "POST",
          auth: false,
          retryOnUnauthorized: false,
          body: { refreshToken },
        });
      }
    } finally {
      this.client.clearTokens();
    }
  }

  me() {
    return this.client.request("/v1/app-auth/me");
  }

  changePassword({ currentPassword, newPassword } = {}) {
    return this.client.request("/v1/app-auth/change-password", {
      method: "POST",
      body: { currentPassword, newPassword },
    });
  }
}

class EntitiesClient {
  constructor(client) {
    this.client = client;
  }

  list() {
    return this.client.request("/v1/data/entities");
  }

  upsert({ name, label, schema, permissions, metadata } = {}) {
    return this.client.request("/v1/data/entities", {
      method: "POST",
      body: {
        name,
        label,
        schema,
        permissions,
        metadata,
      },
    });
  }
}

class DataCollection {
  constructor(client, entity) {
    this.client = client;
    this.entity = entityName(entity);
  }

  list({ limit, offset } = {}) {
    return this.client.request(`/v1/data/${this.entity}${encodeQuery({ limit, offset })}`);
  }

  get(id) {
    return this.client.request(`/v1/data/${this.entity}/${encodeURIComponent(id)}`);
  }

  create(data) {
    return this.client.request(`/v1/data/${this.entity}`, {
      method: "POST",
      body: data,
    });
  }

  update(id, data) {
    return this.client.request(`/v1/data/${this.entity}/${encodeURIComponent(id)}`, {
      method: "PATCH",
      body: data,
    });
  }

  async delete(id) {
    await this.client.request(`/v1/data/${this.entity}/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
    return true;
  }
}
