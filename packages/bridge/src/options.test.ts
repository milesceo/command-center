import { tmpdir } from 'node:os';
import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '@geeked/protocol';
import { DEFAULT_SYSTEM_PROMPT, buildOptions } from './options';

const base: ChatRequest = {
  type: 'chat',
  id: 'c',
  messages: [{ role: 'user', content: 'hi' }],
  tools: 'off',
};
const build = (r: Partial<ChatRequest> = {}, env: NodeJS.ProcessEnv = {}) =>
  buildOptions({ ...base, ...r }, new AbortController(), () => {}, env);

describe('buildOptions', () => {
  it('is plain, isolated chat by default', () => {
    const o = build();
    expect(o.tools).toEqual([]);
    expect(o.maxTurns).toBe(1);
    expect(o.persistSession).toBe(false);
    expect(o.settingSources).toEqual([]);
    expect(o.includePartialMessages).toBe(true);
    expect(o.systemPrompt).toBe(DEFAULT_SYSTEM_PROMPT);
    expect(o).not.toHaveProperty('model');
    expect(o.cwd).toBe(tmpdir());
  });

  it('uses a conversation system prompt and model, ignoring "default"', () => {
    expect(build({ systemPrompt: '  be terse ', model: 'opus' })).toMatchObject({
      systemPrompt: 'be terse',
      model: 'opus',
    });
    expect(build({ model: 'default' })).not.toHaveProperty('model');
  });

  it('read-only mode allows only Read/Glob/Grep and never prompts', () => {
    const o = build({ tools: 'readonly', cwd: '/repo' });
    expect(o.tools).toEqual(['Read', 'Glob', 'Grep']);
    expect(o.allowedTools).toEqual(['Read', 'Glob', 'Grep']);
    expect(o.permissionMode).toBe('dontAsk');
    expect(o.cwd).toBe('/repo');
  });

  it('strips API credentials so the subscription login is always used', () => {
    const o = build({}, { PATH: '/bin', ANTHROPIC_API_KEY: 'sk-x', ANTHROPIC_AUTH_TOKEN: 't' });
    expect(o.env).toEqual({ PATH: '/bin' });
  });
});

describe('Claude runtime location', () => {
  const request: ChatRequest = {
    type: 'chat',
    id: 'c',
    messages: [{ role: 'user', content: 'hi' }],
    tools: 'off',
  };

  it('uses the runtime the installed app points at', () => {
    const options = buildOptions(request, new AbortController(), () => {}, {
      GEEKED_CLAUDE_EXECUTABLE: 'C:\\Program Files\\Geeked\\claude.exe',
    });
    expect(options.pathToClaudeCodeExecutable).toBe('C:\\Program Files\\Geeked\\claude.exe');
  });

  it('leaves the SDK to find its own copy when nothing is configured', () => {
    for (const value of [undefined, '', '   ']) {
      const env = value === undefined ? {} : { GEEKED_CLAUDE_EXECUTABLE: value };
      const options = buildOptions(request, new AbortController(), () => {}, env);
      expect('pathToClaudeCodeExecutable' in options).toBe(false);
    }
  });
});
