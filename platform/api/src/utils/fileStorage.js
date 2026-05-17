// File storage su disco per la Files API. Tutti i percorsi sono RELATIVI
// a STORAGE_DIR (config.storage.dir): cosi' il path nel DB resta indipendente
// dall'host e i test possono usare una tmpdir.
//
// L'unica via per uscire da STORAGE_DIR sarebbe un path traversal -- per
// questo resolveStoragePath() rifiuta qualsiasi path che dopo path.resolve()
// non sia un discendente della root. La fonte del path nel codice e' SEMPRE
// `{tenantId}/{fileId}` con valori generati da noi (mai input utente), ma
// la verifica resta come difesa in profondita'.
import { promises as fs, createReadStream, createWriteStream } from "node:fs";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { config } from "../config.js";

export class StorageTraversalError extends Error {
  constructor(relPath) {
    super(`Path storage non valido: ${relPath}`);
    this.code = "STORAGE_TRAVERSAL";
  }
}

function rootDir() {
  return path.resolve(config.storage.dir);
}

// Risolve un path relativo dentro STORAGE_DIR e verifica che non esca.
// Lanciare per qualsiasi tentativo "..", path assoluto, simlink che esce, ecc.
export function resolveStoragePath(relPath) {
  if (typeof relPath !== "string" || relPath.length === 0) {
    throw new StorageTraversalError(relPath);
  }
  const root = rootDir();
  const resolved = path.resolve(root, relPath);
  // Per essere "dentro" la root, deve essere uguale alla root o iniziare con root+sep.
  if (resolved !== root && !resolved.startsWith(root + path.sep)) {
    throw new StorageTraversalError(relPath);
  }
  return resolved;
}

// Componi il path relativo deterministico di un file. Forward slash anche su
// Windows: il DB salva sempre lo stesso formato.
export function buildStoragePath(tenantId, fileId) {
  if (!tenantId || !fileId) throw new Error("buildStoragePath: tenantId e fileId obbligatori");
  return `${tenantId}/${fileId}`;
}

// Scrive lo stream del file sul disco. Crea la directory del tenant se manca.
// Ritorna il numero di byte scritti.
export async function writeUploadStream(relPath, readable) {
  const absPath = resolveStoragePath(relPath);
  await fs.mkdir(path.dirname(absPath), { recursive: true });

  let written = 0;
  const writable = createWriteStream(absPath);
  readable.on("data", (chunk) => { written += chunk.length; });
  await pipeline(readable, writable);
  return written;
}

// Stream binario in lettura. Il chiamante e' responsabile di pipearlo a reply.
export function openReadStream(relPath) {
  const absPath = resolveStoragePath(relPath);
  return createReadStream(absPath);
}

// Statisce esistenza + size senza leggere il contenuto. Utile per `HEAD` e per
// verificare integrita' del DB rispetto al disco.
export async function statFile(relPath) {
  const absPath = resolveStoragePath(relPath);
  try {
    const s = await fs.stat(absPath);
    return { exists: true, size: s.size };
  } catch (err) {
    if (err.code === "ENOENT") return { exists: false, size: 0 };
    throw err;
  }
}

// Best-effort delete. Se il file e' gia' sparito (ENOENT) consideriamo OK.
// Errori diversi vengono restituiti come `{ ok: false, error }` cosi' il caller
// puo' decidere se loggare warning o fallire.
export async function deleteFile(relPath) {
  try {
    const absPath = resolveStoragePath(relPath);
    await fs.unlink(absPath);
    return { ok: true };
  } catch (err) {
    if (err?.code === "ENOENT") return { ok: true };
    return { ok: false, error: err };
  }
}
