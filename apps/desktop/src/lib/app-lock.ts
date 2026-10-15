/**
 * PIN rules and the browser-side fallback implementation of the lock.
 *
 * In the desktop app the PIN is hashed with Argon2id in Rust (`src-tauri/src/lock.rs`) and these
 * PBKDF2 functions only (a) verify records written by earlier versions so they can be upgraded
 * on first unlock, and (b) back the plain-browser preview and tests, where there is no Rust.
 * This is a screen lock for casual access, not encryption: the chat database is a plain file.
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

/** 4 to 8 characters (letters, digits and symbols allowed), counted by Unicode code point. */
export const isValidPin = (pin: string): boolean => {
  const length = [...pin].length;
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  return length >= PIN_MIN && length <= PIN_MAX && !/[\u0000-\u001f\u007f]/.test(pin);
};

export interface PinStrength {
  /** 0 (weak) to 3 (strong). */
  score: 0 | 1 | 2 | 3;
  label: string;
}

const COMMON = new Set(['1234', '0000', '1111', '4321', '2580', '1212', '12345', '123456']);

/**
 * A hint, not a gate: any 4 to 8 character PIN is accepted. Short PINs are only as safe as the
 * attempt delays that protect them, so this nudges toward longer, mixed ones.
 */
export function pinStrength(pin: string): PinStrength {
  const chars = [...pin];
  if (chars.length === 0) return { score: 0, label: '' };
  const classes =
    Number(/[a-z]/.test(pin)) +
    Number(/[A-Z]/.test(pin)) +
    Number(/\d/.test(pin)) +
    Number(/[^A-Za-z0-9]/.test(pin));
  const unique = new Set(chars).size;
  const sequential = /^(?:0123|1234|2345|3456|4567|5678|6789|abcd|qwer)/i.test(pin);
  if (COMMON.has(pin) || unique === 1 || sequential) return { score: 0, label: 'Easy to guess' };
  let score = 0;
  if (chars.length >= 6) score += 1;
  if (classes >= 2) score += 1;
  if (classes >= 3 || chars.length >= 8) score += 1;
  const capped = Math.min(3, score) as 0 | 1 | 2 | 3;
  const label = ['Weak', 'Okay', 'Good', 'Strong'][capped] ?? 'Weak';
  return { score: capped, label };
}

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
