// Password hashing con argon2id.
// Parametri scelti seguendo OWASP 2024 password storage cheat sheet:
//   memoryCost 19MiB (19456 KiB), timeCost 2, parallelism 1.
// Mai usare bcrypt: ha limite hard di 72 byte e ha causato crash loop in v1.
import argon2 from "argon2";
import { createHash, randomBytes } from "node:crypto";

const OPTS = {
  type: argon2.argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(plain) {
  return argon2.hash(plain, OPTS);
}

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain);
  } catch {
    return false;
  }
}

// Token sicuri per refresh / password reset / email verify.
// Salviamo SOLO l'hash sul DB; il token chiaro viene mostrato all'utente una volta.
export function generateToken(bytes = 32) {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}
