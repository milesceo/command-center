import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { appEnv, resetEnvWarnings } from './env';
import { claudeExecutable, loadQuery } from './sdk';

beforeEach(() => resetEnvWarnings());
afterEach(() => vi.unstubAllEnvs());

const fakeSdk = fileURLToPath(new URL('../test/fake-sdk.mjs', import.meta.url));

describe('appEnv', () => {
  it('reads the current name without warning', () => {
    const warn = vi.fn();
    expect(appEnv('QUERY_MODULE', { COMMAND_CENTER_QUERY_MODULE: '/a.mjs' }, warn)).toBe('/a.mjs');
    expect(warn).not.toHaveBeenCalled();
  });

  it('falls back to the deprecated name and warns once', () => {
    const warn = vi.fn();
    const env = { GEEKED_QUERY_MODULE: '/old.mjs' };
    expect(appEnv('QUERY_MODULE', env, warn)).toBe('/old.mjs');
    expect(appEnv('QUERY_MODULE', env, warn)).toBe('/old.mjs');
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('COMMAND_CENTER_QUERY_MODULE');
  });

  it('prefers the current name when both are set', () => {
    const warn = vi.fn();
    const env = { COMMAND_CENTER_CLAUDE_EXECUTABLE: '/new', GEEKED_CLAUDE_EXECUTABLE: '/old' };
    expect(appEnv('CLAUDE_EXECUTABLE', env, warn)).toBe('/new');
    expect(warn).not.toHaveBeenCalled();
  });

  it('treats an empty value as unset', () => {
    const warn = vi.fn();
    const env = { COMMAND_CENTER_QUERY_MODULE: '', GEEKED_QUERY_MODULE: '/old.mjs' };
    expect(appEnv('QUERY_MODULE', env, warn)).toBe('/old.mjs');
    expect(appEnv('CLAUDE_EXECUTABLE', { GEEKED_CLAUDE_EXECUTABLE: '' }, warn)).toBeUndefined();
  });

  it('is undefined when neither is set', () => {
    expect(appEnv('CLAUDE_EXECUTABLE', {}, vi.fn())).toBeUndefined();
  });

  it('feeds claudeExecutable, including the deprecated name', () => {
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    expect(claudeExecutable({ GEEKED_CLAUDE_EXECUTABLE: ' /opt/claude ' })).toBe('/opt/claude');
    spy.mockRestore();
  });

  it('warns once per variable, not once overall', () => {
    const warn = vi.fn();
    const env = { GEEKED_QUERY_MODULE: '/q', GEEKED_CLAUDE_EXECUTABLE: '/c' };
    appEnv('QUERY_MODULE', env, warn);
    appEnv('CLAUDE_EXECUTABLE', env, warn);
    appEnv('QUERY_MODULE', env, warn);
    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn.mock.calls[1]?.[0]).toContain('GEEKED_CLAUDE_EXECUTABLE');
  });

  it('does not warn when an empty old value is ignored', () => {
    const warn = vi.fn();
    expect(appEnv('QUERY_MODULE', { GEEKED_QUERY_MODULE: '' }, warn)).toBeUndefined();
    expect(warn).not.toHaveBeenCalled();
  });

  it('never puts the value in the warning', () => {
    const warn = vi.fn();
    appEnv('CLAUDE_EXECUTABLE', { GEEKED_CLAUDE_EXECUTABLE: '/home/someone/secret-path' }, warn);
    expect(warn.mock.calls[0]?.[0]).not.toContain('secret-path');
  });

  it('only reads its own names', () => {
    const env = { geeked_QUERY_MODULE: '/lower', COMMAND_CENTERQUERY_MODULE: '/typo' };
    expect(appEnv('QUERY_MODULE', env, vi.fn())).toBeUndefined();
  });

  it('a whitespace-only current value counts as unset, like an empty one', () => {
    const warn = vi.fn();
    const env = { COMMAND_CENTER_CLAUDE_EXECUTABLE: '  ', GEEKED_CLAUDE_EXECUTABLE: '/old' };
    expect(appEnv('CLAUDE_EXECUTABLE', env, warn)).toBe('/old');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('claudeExecutable prefers the current name and ignores blanks', () => {
    expect(
      claudeExecutable({
        COMMAND_CENTER_CLAUDE_EXECUTABLE: '/new',
        GEEKED_CLAUDE_EXECUTABLE: '/old',
      }),
    ).toBe('/new');
    expect(claudeExecutable({})).toBeUndefined();
    expect(claudeExecutable({ COMMAND_CENTER_CLAUDE_EXECUTABLE: '' })).toBeUndefined();
  });

  it('loadQuery loads the override from the current name', async () => {
    vi.stubEnv('COMMAND_CENTER_QUERY_MODULE', fakeSdk);
    expect(typeof (await loadQuery())).toBe('function');
  });

  it('loadQuery still honours the deprecated name, with one warning on stderr', async () => {
    vi.stubEnv('COMMAND_CENTER_QUERY_MODULE', '');
    vi.stubEnv('GEEKED_QUERY_MODULE', fakeSdk);
    const spy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
    try {
      expect(typeof (await loadQuery())).toBe('function');
      await loadQuery();
      const warnings = spy.mock.calls.filter(([m]) => String(m).includes('GEEKED_QUERY_MODULE'));
      expect(warnings).toHaveLength(1);
    } finally {
      spy.mockRestore();
    }
  });
});
