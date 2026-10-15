/**
 * PIN storage for the app lock. This is a screen lock for casual access, not encryption: the
 * PIN is stored as a salted PBKDF2 hash so it cannot be read back from the app's storage, but
 * the chat database itself is not encrypted. Pure functions only; the store in `stores/lock.ts`
 * owns the state.
 */

export const PIN_MIN = 4;
export const PIN_MAX = 8;
const ITERATIONS = 150_000;

export interface LockRecord {
  v: 1;
  /** Base64 salt, unique per PIN. */
  salt: string;
  /** Base64 PBKDF2-SHA-256 output. */
  hash: string;
  iterations: number;
}

export const isValidPin = (pin: string): boolean =>
  new RegExp(`^\\d{${PIN_MIN},${PIN_MAX}}$`).test(pin);

const toBase64 = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
};

const fromBase64 = (text: string): Uint8Array<ArrayBuffer> => {
  const binary = atob(text);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

async function derive(pin: string, salt: Uint8Array<ArrayBuffer>, iterations: number) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt, iterations },
    key,
    256,
  );
  return new Uint8Array(bits);
}

/** Hashes a new PIN with a fresh random salt. */
export async function createRecord(pin: string, iterations = ITERATIONS): Promise<LockRecord> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(pin, salt, iterations);
  return { v: 1, salt: toBase64(salt), hash: toBase64(hash), iterations };
}

/** Compares in constant time so timing does not reveal how many leading digits matched. */
export async function checkPin(record: LockRecord, pin: string): Promise<boolean> {
  const expected = fromBase64(record.hash);
  const actual = await derive(pin, fromBase64(record.salt), record.iterations);
  if (expected.length !== actual.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= (expected[i] ?? 0) ^ (actual[i] ?? 0);
  return diff === 0;
}

/** Reads a stored record defensively: anything malformed counts as "no PIN". */
export function parseRecord(raw: string | null): LockRecord | null {
  if (!raw) return null;
  try {
    const value: unknown = JSON.parse(raw);
    if (typeof value !== 'object' || value === null) return null;
    const v = value as Partial<LockRecord>;
    if (
      v.v !== 1 ||
      typeof v.salt !== 'string' ||
      typeof v.hash !== 'string' ||
      typeof v.iterations !== 'number' ||
      !Number.isInteger(v.iterations) ||
      v.iterations < 1000
    ) {
      return null;
    }
    return { v: 1, salt: v.salt, hash: v.hash, iterations: v.iterations };
  } catch {
    return null;
  }
}

/** Failures allowed before waiting starts. */
export const FREE_ATTEMPTS = 5;

/**
 * Seconds to wait after `failures` consecutive wrong PINs: none for the first few, then
 * 30 s doubling up to 5 minutes. Persisted by the store, so restarting does not reset it.
 */
export function lockoutSeconds(failures: number): number {
  if (failures < FREE_ATTEMPTS) return 0;
  return Math.min(300, 30 * 2 ** (failures - FREE_ATTEMPTS));
}
