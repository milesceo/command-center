import { describe, expect, it } from 'vitest';
import type { Conversation, Message, Project } from '../../lib/types';
import { buildTurns, firstLine, groupThreads } from './threads';

const conv = (id: string, projectId: string | null, updatedAt: number): Conversation => ({
  id,
  title: id,
  pinned: false,
  createdAt: 0,
  updatedAt,
  provider: 'claude',
  model: null,
  systemPrompt: null,
  systemPromptId: null,
  systemPromptVars: {},
  toolsMode: 'off',
  cwd: null,
  projectId,
  modelParams: null,
});

const project = (id: string, name: string): Project => ({
  id,
  name,
  defaultSystemPromptId: null,
  defaultSystemPromptVars: {},
  createdAt: 0,
  updatedAt: 0,
});

const msg = (id: string, role: Message['role']): Message => ({
  id,
  conversationId: 'c',
  role,
  content: id,
  attachments: [],
  status: 'complete',
  error: null,
  model: null,
  inputTokens: null,
  outputTokens: null,
  cacheReadTokens: null,
  cacheCreationTokens: null,
  costUsd: null,
  createdAt: 0,
});

describe('groupThreads', () => {
  it('orders projects by name, threads by recency, and puts loose threads last', () => {
    const groups = groupThreads(
      [conv('a', 'p2', 1), conv('b', 'p1', 5), conv('c', 'p1', 9), conv('d', null, 3)],
      [project('p2', 'Zeta'), project('p1', 'Alpha')],
    );
    expect(groups.map((g) => g.project?.name ?? null)).toEqual(['Alpha', 'Zeta', null]);
    expect(groups[0]?.conversations.map((c) => c.id)).toEqual(['c', 'b']);
  });
});

describe('buildTurns', () => {
  it('pairs prompts with replies and tolerates an unanswered last prompt', () => {
    const turns = buildTurns([msg('u1', 'user'), msg('a1', 'assistant'), msg('u2', 'user')]);
    expect(turns).toHaveLength(2);
    expect(turns[0]?.assistant?.id).toBe('a1');
    expect(turns[1]?.assistant).toBeNull();
  });
});

describe('firstLine', () => {
  it('strips markdown markers and clips', () => {
    expect(firstLine('\n## Hello world\nmore')).toBe('Hello world');
    expect(firstLine('x'.repeat(100), 10)).toBe('xxxxxxxxx…');
  });
});
