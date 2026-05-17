// Test fileStorage util. Usa una tmpdir per non sporcare il filesystem reale.
// IMPORTANTE: setta STORAGE_DIR PRIMA di importare il modulo, perche' config
// legge le env al module load.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs, createReadStream } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";

const TMP_ROOT = path.join(tmpdir(), `mc-storage-test-${process.pid}-${Date.now()}`);
process.env.STORAGE_DIR = TMP_ROOT;
process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://noop";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret-must-be-at-least-32-characters-long";

const {
  resolveStoragePath, buildStoragePath, writeUploadStream,
  openReadStream, statFile, deleteFile, StorageTraversalError,
} = await import("./fileStorage.js");

before(async () => {
  await fs.mkdir(TMP_ROOT, { recursive: true });
});

after(async () => {
  await fs.rm(TMP_ROOT, { recursive: true, force: true });
});

test("buildStoragePath produces tenant/file form with forward slash", () => {
  assert.equal(buildStoragePath("t-1", "f-1"), "t-1/f-1");
});

test("buildStoragePath throws on missing parts", () => {
  assert.throws(() => buildStoragePath("", "f"));
  assert.throws(() => buildStoragePath("t", ""));
  assert.throws(() => buildStoragePath(null, null));
});

test("resolveStoragePath rejects traversal via ..", () => {
  assert.throws(() => resolveStoragePath("../escape"), { code: "STORAGE_TRAVERSAL" });
  assert.throws(() => resolveStoragePath("tenant/../../escape"), { code: "STORAGE_TRAVERSAL" });
});

test("resolveStoragePath rejects absolute path", () => {
  const abs = process.platform === "win32" ? "C:\\windows\\system32" : "/etc/passwd";
  assert.throws(() => resolveStoragePath(abs), { code: "STORAGE_TRAVERSAL" });
});

test("resolveStoragePath rejects empty/invalid input", () => {
  assert.throws(() => resolveStoragePath(""), { code: "STORAGE_TRAVERSAL" });
  assert.throws(() => resolveStoragePath(null), { code: "STORAGE_TRAVERSAL" });
  assert.throws(() => resolveStoragePath(42), { code: "STORAGE_TRAVERSAL" });
});

test("resolveStoragePath accepts a valid subpath under the root", () => {
  const out = resolveStoragePath("tenant-1/file-abc");
  assert.equal(out, path.join(TMP_ROOT, "tenant-1", "file-abc"));
});

test("writeUploadStream creates dirs and writes bytes; statFile sees them", async () => {
  const rel = "tenant-w/file-w";
  const data = Buffer.from("hello world, mellucode");
  const written = await writeUploadStream(rel, Readable.from([data]));
  assert.equal(written, data.length);
  const stat = await statFile(rel);
  assert.equal(stat.exists, true);
  assert.equal(stat.size, data.length);
});

test("openReadStream reads back exactly what was written", async () => {
  const rel = "tenant-r/file-r";
  const data = Buffer.from("0123456789".repeat(100));
  await writeUploadStream(rel, Readable.from([data]));

  const chunks = [];
  for await (const c of openReadStream(rel)) chunks.push(c);
  assert.deepEqual(Buffer.concat(chunks), data);
});

test("deleteFile removes file and is idempotent on ENOENT", async () => {
  const rel = "tenant-d/file-d";
  await writeUploadStream(rel, Readable.from([Buffer.from("bye")]));
  assert.equal((await statFile(rel)).exists, true);

  const first = await deleteFile(rel);
  assert.equal(first.ok, true);
  assert.equal((await statFile(rel)).exists, false);

  // delete su file inesistente non e' errore
  const second = await deleteFile(rel);
  assert.equal(second.ok, true);
});

test("statFile returns exists=false for missing files (no throw)", async () => {
  const stat = await statFile("nope/nope");
  assert.equal(stat.exists, false);
  assert.equal(stat.size, 0);
});

test("StorageTraversalError carries the requested relPath in the message", () => {
  try {
    resolveStoragePath("../boom");
    assert.fail("should have thrown");
  } catch (err) {
    assert.ok(err instanceof StorageTraversalError);
    assert.match(err.message, /\.\.\/boom/);
  }
});
