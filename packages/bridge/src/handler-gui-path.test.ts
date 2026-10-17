import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  PROTOCOL_VERSION,
  encodeMessage,
  type BridgeRequest,
  type ProviderId,
} from '@command-center/protocol';
import type * as ProcessModule from './providers/process';
import type { GuiPathDeps } from './providers/process';
import type { Provider } from './providers/types';
import { collector, scripted } from './testing';

// The real primeLoginShellPath would run the user's login shell; replace it with a promise the
// test controls (by default one that never settles, like a shell that hangs).
const hoisted = vi.hoisted(() => ({
  prime: vi.fn<(env: NodeJS.ProcessEnv) => Promise<void>>(),
}));
vi.mock('./providers/process', async (importOriginal) => {
  const actual = await importOriginal<typeof ProcessModule>();
  return { ...actual, primeLoginShellPath: hoisted.prime };
});

const { Bridge } = await import('./handler');

const NO_GUI_PATH: GuiPathDeps = { loginShellPath: () => null, listDir: () => [] };
const line = (r: BridgeRequest) => encodeMessage(r);
const flush = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

/** Stand-ins for every registered provider, so nothing real is looked up once requests run. */
function fakeProviders(): Provider[] {
  return (['claude', 'openai', 'xai'] as ProviderId[]).map((id) => ({
    id,
    displayName: id,
    authMethods: ['subscription'],
    note: '',
    models: () => [],
    authStatus: () => Promise.resolve({ state: 'signed_in' as const }),
    chat: () => ({ done: Promise.resolve(), cancel: () => undefined }),
    login: () => Promise.resolve(),
    usage: (reqId, ctx) => {
      ctx.emit({ type: 'error', id: reqId, error: { code: 'internal', message: 'usage ran' } });
      return Promise.resolve();
    },
  }));
}

function bridge(over: { platform?: NodeJS.Platform; gui?: GuiPathDeps } = {}) {
  const out = collector();
  const env = { PATH: '/usr/bin' };
  const b = new Bridge({
    getQuery: () => Promise.resolve(scripted([])),
    emit: out.emit,
    env,
    platform: over.platform ?? 'darwin',
    ...(over.gui ? { gui: over.gui } : {}),
    providers: fakeProviders(),
  });
  return { b, out, env };
}

const never = () => new Promise<void>(() => undefined);

beforeEach(() => {
  hoisted.prime.mockReset();
  hoisted.prime.mockImplementation(never);
});

describe('Bridge login-shell PATH on macOS', () => {
  it('starts reading the login PATH once, at construction, with the bridge env', () => {
    const { env } = bridge();
    expect(hoisted.prime).toHaveBeenCalledTimes(1);
    expect(hoisted.prime).toHaveBeenCalledWith(env);
  });

  it('answers ping immediately even if the login shell never answers', () => {
    const { b, out } = bridge();
    b.handleLine(line({ type: 'ping', id: 'p', sentAt: 7 }));
    expect(out.events).toEqual([
      {
        type: 'pong',
        id: 'p',
        sentAt: 7,
        protocolVersion: PROTOCOL_VERSION,
        bridgeVersion: expect.any(String) as string,
      },
    ]);
  });

  it('holds providers, provider.login and usage until the PATH is known', async () => {
    let release!: () => void;
    hoisted.prime.mockImplementation(() => new Promise<void>((r) => (release = r)));
    const { b, out } = bridge();
    b.handleLine(line({ type: 'providers', id: 'r1' }));
    b.handleLine(line({ type: 'provider.login', id: 'l1', provider: 'openai' }));
    b.handleLine(line({ type: 'usage', id: 'u1' }));
    await flush();
    expect(out.events).toEqual([]);

    // A ping in the meantime is still answered at once.
    b.handleLine(line({ type: 'ping', id: 'p', sentAt: 1 }));
    expect(out.types).toEqual(['pong']);

    release();
    await flush();
    const byId = (id: string) => out.events.filter((e) => 'id' in e && e.id === id);
    expect(byId('r1').map((e) => e.type)).toEqual(['providers.report']);
    expect(byId('l1').map((e) => e.type)).toEqual(['providers.report']);
    expect(byId('u1')).toMatchObject([{ type: 'error', error: { message: 'usage ran' } }]);
  });

  it('does not run the login shell when PATH discovery is injected (tests)', async () => {
    const { b, out } = bridge({ gui: NO_GUI_PATH });
    expect(hoisted.prime).not.toHaveBeenCalled();
    b.handleLine(line({ type: 'providers', id: 'r1' }));
    await flush();
    expect(out.types).toEqual(['providers.report']);
  });

  it.each(['win32', 'linux'] as const)('never reads a login shell on %s', async (platform) => {
    const { b, out } = bridge({ platform });
    expect(hoisted.prime).not.toHaveBeenCalled();
    b.handleLine(line({ type: 'providers', id: 'r1' }));
    b.handleLine(line({ type: 'usage', id: 'u1' }));
    await flush();
    expect([...out.types].sort()).toEqual(['error', 'providers.report']);
  });

  it('still turns garbage into an error at once while the PATH is pending', () => {
    const { b, out } = bridge();
    b.handleLine('not json');
    expect(out.events[0]).toMatchObject({ type: 'error', error: { code: 'invalid_message' } });
  });
});
