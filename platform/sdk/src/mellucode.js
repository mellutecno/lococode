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
    this.files = new FilesClient(this);
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
      rawBody,            // FormData/Blob/Buffer: niente JSON.stringify, niente Content-Type forzato
      auth = true,
      retryOnUnauthorized = true,
      headers = {},
      responseType = "json", // "json" | "blob" | "response"
    } = options;

    const finalHeaders = {
      "X-Tenant-Slug": this.tenantSlug,
      ...headers,
    };

    let fetchBody;
    if (rawBody !== undefined) {
      // FormData / Blob: il browser / undici settano da soli il Content-Type
      // (con boundary corretto). Non sovrascrivere.
      fetchBody = rawBody;
    } else if (body !== undefined) {
      finalHeaders["Content-Type"] = finalHeaders["Content-Type"] || "application/json";
      fetchBody = JSON.stringify(body);
    }

    if (auth && this.accessToken) finalHeaders.Authorization = `Bearer ${this.accessToken}`;

    const response = await this.fetch(`${this.apiUrl}${cleanPath(path)}`, {
      method,
      headers: finalHeaders,
      body: fetchBody,
    });

    if (response.status === 401 && auth && retryOnUnauthorized && this.refreshToken) {
      try {
        await this.auth.refresh();
        return this.#request(path, { ...options, retryOnUnauthorized: false });
      } catch {
        this.clearTokens();
      }
    }

    if (responseType === "response") {
      if (!response.ok) {
        const payload = await parseResponse(response);
        const message = payload?.error || payload?.message || `Errore MelluCode API (${response.status}).`;
        throw new MelluCodeError(message, { status: response.status, payload });
      }
      return response;
    }

    if (responseType === "blob") {
      if (!response.ok) {
        const payload = await parseResponse(response);
        const message = payload?.error || payload?.message || `Errore MelluCode API (${response.status}).`;
        throw new MelluCodeError(message, { status: response.status, payload });
      }
      return response.blob();
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

class FilesClient {
  constructor(client) {
    this.client = client;
  }

  // Upload di un File / Blob (browser) o un Buffer/Stream (node via fetch undici).
  // Accetta anche un terzo arg `metadata` (oggetto JSON serializzabile).
  async upload(file, { metadata, filename } = {}) {
    if (!file) throw new MelluCodeError("File mancante.");
    const FormDataCtor = globalThis.FormData;
    if (!FormDataCtor) throw new MelluCodeError("FormData non disponibile in questo ambiente.");

    const form = new FormDataCtor();
    if (filename) {
      form.append("file", file, filename);
    } else {
      form.append("file", file);
    }
    if (metadata !== undefined) {
      form.append("metadata", JSON.stringify(metadata));
    }

    return this.client.request("/v1/files/upload", {
      method: "POST",
      rawBody: form,
    });
  }

  list({ limit, offset } = {}) {
    return this.client.request(`/v1/files${encodeQuery({ limit, offset })}`);
  }

  get(id) {
    return this.client.request(`/v1/files/${encodeURIComponent(id)}`);
  }

  async delete(id) {
    await this.client.request(`/v1/files/${encodeURIComponent(id)}`, { method: "DELETE" });
    return true;
  }

  // Stream binario come Blob: per visualizzare immagini in <img src> usare
  // `URL.createObjectURL(await mc.files.downloadBlob(id))`.
  downloadBlob(id) {
    return this.client.request(`/v1/files/${encodeURIComponent(id)}/content`, {
      responseType: "blob",
    });
  }

  // URL diretto verso il backend. NB: richiede bearer header, quindi non
  // funziona in <img src>. Utile per debug o per costruire fetch custom.
  url(id) {
    return `${this.client.apiUrl}/v1/files/${encodeURIComponent(id)}/content`;
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
