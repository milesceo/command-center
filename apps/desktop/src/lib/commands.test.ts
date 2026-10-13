import { describe, expect, it } from 'vitest';
import { filterCommands, matchScore, type Command } from './commands';

const cmd = (title: string, group = 'Actions', keywords?: string): Command => ({
  id: title,
  title,
  group,
  ...(keywords ? { keywords } : {}),
  run: () => {},
});

describe('matchScore', () => {
  it('ranks prefix > word start > substring > subsequence, and rejects non-matches', () => {
    const prefix = matchScore('new', 'New chat')!;
    const word = matchScore('chat', 'New chat')!;
    const sub = matchScore('ew c', 'New chat')!;
    const scattered = matchScore('nct', 'New chat')!;
    expect(prefix).toBeGreaterThan(word);
    expect(word).toBeGreaterThan(sub);
    expect(sub).toBeGreaterThan(scattered);
    expect(matchScore('zzz', 'New chat')).toBeNull();
    expect(matchScore('', 'anything')).toBe(0);
  });

  it('is case-insensitive and treats regex characters literally', () => {
    expect(matchScore('NEW', 'new chat')).not.toBeNull();
    expect(matchScore('a.b', 'a.b file')).not.toBeNull();
    expect(matchScore('(', 'x (y)')).not.toBeNull();
  });
});

describe('filterCommands', () => {
  const all = [
    cmd('New chat'),
    cmd('Open settings', 'Actions', 'preferences'),
    cmd('Toggle sidebar'),
    cmd('Fix the bug', 'Conversations'),
  ];

  it('keeps the given order without a query', () => {
    expect(filterCommands(all, '').map((c) => c.title)).toEqual(all.map((c) => c.title));
  });

  it('finds by title, by keyword and by group, best first', () => {
    expect(filterCommands(all, 'new')[0]?.title).toBe('New chat');
    expect(filterCommands(all, 'prefer').map((c) => c.title)).toEqual(['Open settings']);
    expect(filterCommands(all, 'conversations').map((c) => c.title)).toEqual(['Fix the bug']);
  });

  it('returns nothing when nothing matches and respects the limit', () => {
    expect(filterCommands(all, 'qqq')).toEqual([]);
    expect(filterCommands(all, '', 2)).toHaveLength(2);
  });
});
