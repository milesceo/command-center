import { describe, expect, it } from 'vitest';
import {
  COST_LABEL,
  formatAgo,
  formatCost,
  formatPercent,
  formatTokens,
  formatUsd,
} from './format';

describe('formatTokens', () => {
  it('uses compact units with sensible precision', () => {
    expect(formatTokens(0)).toBe('0');
    expect(formatTokens(842)).toBe('842');
    expect(formatTokens(1000)).toBe('1k');
    expect(formatTokens(1234)).toBe('1.23k');
    expect(formatTokens(12_400)).toBe('12.4k');
    expect(formatTokens(124_000)).toBe('124k');
    expect(formatTokens(3_100_000)).toBe('3.1M');
  });
});

describe('formatUsd / formatCost', () => {
  it('shows cents normally and more precision for tiny amounts', () => {
    expect(formatUsd(12.345)).toBe('$12.35');
    expect(formatUsd(0.1234)).toBe('$0.12');
    expect(formatUsd(0.0002472)).toBe('$0.0002');
    expect(formatUsd(0.00001)).toBe('<$0.0001');
    expect(formatUsd(0)).toBe('$0.00');
  });
  it('is explicit when the SDK reported no cost, or only part of it', () => {
    expect(formatCost(null)).toBe('—');
    expect(formatCost(1.5, false)).toBe('≥ $1.50');
    expect(formatCost(1.5)).toBe('$1.50');
  });
  it('labels cost as informational', () => {
    expect(COST_LABEL).toBe('API-equivalent cost');
  });
});

describe('formatPercent', () => {
  it('rounds a fraction', () => {
    expect(formatPercent(0.376)).toBe('38%');
  });
});

describe('formatAgo', () => {
  it('describes how stale a reading is', () => {
    const now = 10_000_000;
    expect(formatAgo(now - 10_000, now)).toBe('just now');
    expect(formatAgo(now - 5 * 60_000, now)).toBe('5 min ago');
    expect(formatAgo(now - 3 * 3_600_000, now)).toBe('3 h ago');
    expect(formatAgo(now - 2 * 86_400_000, now)).toBe('2 d ago');
    expect(formatAgo(now + 5000, now)).toBe('just now');
  });
});
