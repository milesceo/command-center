import { describe, expect, it } from 'vitest';
import {
  checkPin,
  createRecord,
  FREE_ATTEMPTS,
  isValidPin,
  lockoutSeconds,
  parseRecord,
  pinStrength,
} from './app-lock';

describe('isValidPin', () => {
  it('accepts 4 to 8 characters including letters and symbols', () => {
    expect(isValidPin('1234')).toBe(true);
    expect(isValidPin('12345678')).toBe(true);
    expect(isValidPin('12a4')).toBe(true);
    expect(isValidPin('p@ss!')).toBe(true);
    expect(isValidPin('ünï€')).toBe(true);
    expect(isValidPin('123')).toBe(false);
    expect(isValidPin('123456789')).toBe(false);
    expect(isValidPin('')).toBe(false);
  });

  it('refuses control characters and counts emoji as one character', () => {
    expect(isValidPin('ab\tcd')).toBe(false);
    expect(isValidPin('ab\ncd')).toBe(false);
    expect(isValidPin('😀😀😀😀')).toBe(true);
    expect(isValidPin('😀'.repeat(9))).toBe(false);
  });
});

describe('pinStrength', () => {
  it('flags guessable PINs as weak and rewards length and variety', () => {
    expect(pinStrength('').label).toBe('');
    expect(pinStrength('1234').score).toBe(0);
    expect(pinStrength('0000').score).toBe(0);
    expect(pinStrength('aaaaaa').score).toBe(0);
    expect(pinStrength('4829').score).toBeLessThanOrEqual(1);
    expect(pinStrength('k3#Zp9').score).toBeGreaterThanOrEqual(2);
    expect(pinStrength('k3#Zp9!x').score).toBe(3);
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
