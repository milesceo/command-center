import { describe, expect, it } from 'vitest';
import {
  checkPin,
  createRecord,
  FREE_ATTEMPTS,
  isValidPin,
  lockoutSeconds,
  parseRecord,
} from './app-lock';

describe('isValidPin', () => {
  it('accepts 4 to 8 digits only', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('12a4')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });
});

describe('records', () => {
  // Few iterations keep the test fast; the algorithm is the same.
  it('verifies the right PIN and rejects a wrong one', async () => {
    const record = await createRecord('4821', 2000);
    expect(await checkPin(record, '4821')).toBe(true);
    expect(await checkPin(record, '4822')).toBe(false);
    expect(await checkPin(record, '')).toBe(false);
  });

  it('salts every record so equal PINs hash differently', async () => {
    const a = await createRecord('1111', 2000);
    const b = await createRecord('1111', 2000);
    expect(a.salt).not.toBe(b.salt);
    expect(a.hash).not.toBe(b.hash);
    expect(JSON.stringify(a)).not.toContain('1111');
  });

  it('round-trips through storage and treats junk as no PIN', async () => {
    const record = await createRecord('9090', 2000);
    expect(parseRecord(JSON.stringify(record))).toEqual(record);
    expect(parseRecord(null)).toBeNull();
    expect(parseRecord('not json')).toBeNull();
    expect(parseRecord('{"v":2}')).toBeNull();
    expect(parseRecord(JSON.stringify({ ...record, iterations: 5 }))).toBeNull();
  });
});

describe('lockoutSeconds', () => {
  it('is free for the first attempts, then doubles up to five minutes', () => {
    expect(lockoutSeconds(0)).toBe(0);
    expect(lockoutSeconds(FREE_ATTEMPTS - 1)).toBe(0);
    expect(lockoutSeconds(FREE_ATTEMPTS)).toBe(30);
    expect(lockoutSeconds(FREE_ATTEMPTS + 1)).toBe(60);
    expect(lockoutSeconds(FREE_ATTEMPTS + 2)).toBe(120);
    expect(lockoutSeconds(FREE_ATTEMPTS + 20)).toBe(300);
  });
});
