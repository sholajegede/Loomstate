/**
 * Envelope encryption for the keys a user brings. The key material lives in the
 * deployment environment, so a database copy alone cannot read a user's key.
 * Only actions may call these functions; queries and mutations must not.
 */

const ALGORITHM = "AES-GCM";

async function serverKey(): Promise<CryptoKey> {
  const raw = process.env.SECRETS_KEY;
  if (raw === undefined || raw === "") {
    throw new Error("SECRETS_KEY is not set on this deployment.");
  }
  const bytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  return await crypto.subtle.importKey("raw", bytes, ALGORITHM, false, [
    "encrypt",
    "decrypt",
  ]);
}

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(text: string): Uint8Array<ArrayBuffer> {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

export async function encryptSecret(
  plaintext: string,
): Promise<{ ciphertext: string; iv: string }> {
  const key = await serverKey();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const sealed = await crypto.subtle.encrypt({ name: ALGORITHM, iv }, key, encoded);
  return {
    ciphertext: toBase64(new Uint8Array(sealed)),
    iv: toBase64(iv),
  };
}

export async function decryptSecret(
  ciphertext: string,
  iv: string,
): Promise<string> {
  const key = await serverKey();
  const opened = await crypto.subtle.decrypt(
    { name: ALGORITHM, iv: fromBase64(iv) },
    key,
    fromBase64(ciphertext),
  );
  return new TextDecoder().decode(opened);
}

/** The last four characters, so the owner can tell which key is stored. */
export function keyHint(plaintext: string): string {
  return plaintext.length <= 4 ? "****" : `...${plaintext.slice(-4)}`;
}
