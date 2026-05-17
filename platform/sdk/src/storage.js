export function createMemoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return data.has(key) ? data.get(key) : null;
    },
    setItem(key, value) {
      data.set(key, String(value));
    },
    removeItem(key) {
      data.delete(key);
    },
  };
}

export function createDefaultStorage() {
  try {
    if (typeof globalThis.window !== "undefined" && typeof globalThis.localStorage !== "undefined") {
      const probe = "__mellucode_probe__";
      globalThis.localStorage.setItem(probe, "1");
      globalThis.localStorage.removeItem(probe);
      return globalThis.localStorage;
    }
  } catch {
    // Privacy mode or disabled storage: fall back to memory.
  }
  return createMemoryStorage();
}
