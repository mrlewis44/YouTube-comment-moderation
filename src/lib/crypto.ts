// Symmetric encryption for channel refresh tokens at rest (SPEC Section 3).
// AES-256-GCM. The key comes from TOKEN_ENCRYPTION_KEY; any string is accepted
// and hashed to a 32-byte key so ops can use a passphrase or a generated key.
// Stored form is "v1:<iv b64>:<authTag b64>:<ciphertext b64>".

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import { ENV } from "./env";

const VERSION = "v1";

function key(): Buffer {
  if (!ENV.tokenEncryptionKey) {
    throw new Error("TOKEN_ENCRYPTION_KEY is not set");
  }
  // Deterministic 32-byte key from whatever string was provided.
  return createHash("sha256").update(ENV.tokenEncryptionKey).digest();
}

export function encryptToken(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, iv.toString("base64"), tag.toString("base64"), ct.toString("base64")].join(":");
}

export function decryptToken(stored: string): string {
  const [version, ivB64, tagB64, ctB64] = stored.split(":");
  if (version !== VERSION) {
    throw new Error(`Unsupported token encryption version: ${version}`);
  }
  const decipher = createDecipheriv("aes-256-gcm", key(), Buffer.from(ivB64, "base64"));
  decipher.setAuthTag(Buffer.from(tagB64, "base64"));
  return Buffer.concat([
    decipher.update(Buffer.from(ctB64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}
