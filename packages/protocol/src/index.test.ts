import { describe, expect, it } from 'vitest';
import {
  PROTOCOL_VERSION,
  encodeMessage,
  isTerminalEvent,
  parseEvent,
  parseRequest,
  type BridgeEvent,
  type BridgeRequest,
  PROVIDER_IDS,
} from './index';

const roundTripRequest = (r: BridgeRequest) => parseRequest(encodeMessage(r));
const roundTripEvent = (e: BridgeEvent) => parseEvent(encodeMessage(e));

describe('encoding', () => {
  it('writes exactly one line per message', () => {
    const line = encodeMessage({ type: 'ping', id: 'a', sentAt: 1 });
    expect(line.endsWith('\n')).toBe(true);
    expect(line.trim().includes('\n')).toBe(false);
  });

  it('keeps newlines inside strings escaped', () => {
    const line = encodeMessage({ type: 'chat.text', id: 'a', text: 'a\nb' });
    expect(line.trim().split('\n')).toHaveLength(1);
  });
});

describe('requests', () => {
  it('round-trips ping, chat and cancel', () => {
    expect(roundTripRequest({ type: 'ping', id: 'a', sentAt: 5 })).toMatchObject({ ok: true });
    const chat: BridgeRequest = {
      type: 'chat',
      id: 'c1',
      messages: [
        { role: 'user', content: 'hi', attachments: [{ name: 'a.ts', text: 'x' }] },
        { role: 'assistant', content: 'hello' },
        { role: 'user', content: 'again' },
      ],
      model: 'sonnet',
      systemPrompt: 'be brief',
      tools: 'readonly',
      cwd: '/repo',
    };
    expect(roundTripRequest(chat)).toEqual({ ok: true, value: chat });
    const cancel: BridgeRequest = { type: 'cancel', id: 'x', targetId: 'c1' };
    expect(roundTripRequest(cancel)).toEqual({ ok: true, value: cancel });
  });

  it('rejects malformed input without throwing', () => {
    expect(parseRequest('not json')).toMatchObject({
      ok: false,
      error: { code: 'invalid_message' },
    });
    expect(parseRequest('[]')).toMatchObject({ ok: false });
    expect(parseRequest('{"type":"ping"}')).toMatchObject({ ok: false });
  });

  it('flags unknown request types', () => {
    expect(parseRequest('{"type":"nope","id":"x"}')).toMatchObject({
      ok: false,
      error: { code: 'unknown_request' },
    });
  });

  it('validates chat structure', () => {
    const base = { type: 'chat', id: 'c', tools: 'off' };
    const parse = (extra: object) => parseRequest(JSON.stringify({ ...base, ...extra }));
    expect(parse({ messages: [] })).toMatchObject({ ok: false });
    expect(parse({ messages: [{ role: 'system', content: 'x' }] })).toMatchObject({ ok: false });
    expect(parse({ messages: [{ role: 'assistant', content: 'x' }] })).toMatchObject({
      ok: false,
      error: { message: expect.stringContaining('last') },
    });
    expect(parse({ messages: [{ role: 'user', content: 'x' }], tools: 'all' })).toMatchObject({
      ok: false,
    });
    expect(
      parse({ messages: [{ role: 'user', content: 'x', attachments: [{ name: 1 }] }] }),
    ).toMatchObject({ ok: false });
  });

  it('requires a cwd for read-only tools', () => {
    const line = JSON.stringify({
      type: 'chat',
      id: 'c',
      tools: 'readonly',
      messages: [{ role: 'user', content: 'x' }],
    });
    expect(parseRequest(line)).toMatchObject({ ok: false });
  });

  it('round-trips a usage request', () => {
    expect(roundTripRequest({ type: 'usage', id: 'u' })).toEqual({
      ok: true,
      value: { type: 'usage', id: 'u' },
    });
  });

  it('requires a targetId on cancel', () => {
    expect(parseRequest('{"type":"cancel","id":"x"}')).toMatchObject({ ok: false });
  });
});

describe('events', () => {
  const events: BridgeEvent[] = [
    { type: 'pong', id: 'a', sentAt: 5, protocolVersion: PROTOCOL_VERSION, bridgeVersion: '0.1.0' },
    { type: 'chat.text', id: 'c', text: 'hello' },
    { type: 'chat.tool_use', id: 'c', toolUseId: 't', name: 'Read', summary: 'src/a.ts' },
    { type: 'chat.tool_result', id: 'c', toolUseId: 't', isError: false },
    {
      type: 'chat.rate_limit',
      id: 'c',
      status: 'allowed_warning',
      limitType: 'five_hour',
      resetsAt: 9,
      utilization: 0.9,
    },
    {
      type: 'chat.done',
      id: 'c',
      status: 'completed',
      model: 'm',
      usage: {
        inputTokens: 1,
        outputTokens: 2,
        cacheReadTokens: 3,
        cacheCreationTokens: 4,
        costUsd: 0.01,
        models: [
          {
            model: 'm-a',
            inputTokens: 1,
            outputTokens: 2,
            cacheReadTokens: 3,
            cacheCreationTokens: 4,
            costUsd: 0.01,
          },
        ],
      },
      durationMs: 10,
    },
    { type: 'chat.done', id: 'c', status: 'cancelled' },
    {
      type: 'chat.limits',
      id: 'c',
      windows: [
        { key: 'five_hour', label: '5-hour', utilization: 0.1, resetsAt: 1_791_916_800_000 },
        { key: 'seven_day', label: 'Weekly', utilization: null, resetsAt: null },
      ],
    },
    {
      type: 'usage.report',
      id: 'u',
      available: true,
      subscriptionType: 'max',
      windows: [{ key: 'five_hour', label: '5-hour', utilization: 0.42, resetsAt: 5 }],
      extraUsage: {
        enabled: true,
        usedCredits: 1.5,
        monthlyLimit: 20,
        utilization: 0.075,
        currency: 'USD',
      },
    },
    {
      type: 'usage.report',
      id: 'u',
      available: false,
      subscriptionType: null,
      windows: [],
      extraUsage: null,
    },
    {
      type: 'error',
      id: 'c',
      error: { code: 'usage_limit', message: 'm', resetsAt: 5, limitType: 'five_hour' },
    },
    { type: 'error', error: { code: 'internal', message: 'm' } },
  ];

  it.each(events)('round-trips $type', (event) => {
    expect(roundTripEvent(event)).toEqual({ ok: true, value: event });
  });

  it('omits the id on errors that have none', () => {
    const parsed = parseEvent('{"type":"error","error":{"code":"internal","message":"m"}}');
    expect(parsed.ok && 'id' in parsed.value).toBe(false);
  });

  it('rejects unknown or incomplete events', () => {
    expect(parseEvent('{"type":"chat.text","id":"c"}')).toMatchObject({ ok: false });
    expect(parseEvent('{"type":"mystery","id":"c"}')).toMatchObject({ ok: false });
    expect(parseEvent('{"type":"chat.done","id":"c","status":"weird"}')).toMatchObject({
      ok: false,
    });
  });

  it('rejects malformed usage and limit payloads', () => {
    const done = (usage: unknown) =>
      parseEvent(JSON.stringify({ type: 'chat.done', id: 'c', status: 'completed', usage }));
    // A usage object without the cache fields (the v2 shape) is dropped rather than half-trusted.
    expect(done({ inputTokens: 1, outputTokens: 2 })).toEqual({
      ok: true,
      value: { type: 'chat.done', id: 'c', status: 'completed' },
    });
    expect(
      parseEvent(
        '{"type":"chat.limits","id":"c","windows":[{"key":"k","label":"l","utilization":"x","resetsAt":null}]}',
      ),
    ).toMatchObject({ ok: false });
    expect(
      parseEvent(
        '{"type":"usage.report","id":"u","available":"yes","subscriptionType":null,"windows":[],"extraUsage":null}',
      ),
    ).toMatchObject({ ok: false });
  });

  it('knows which events are terminal', () => {
    expect(isTerminalEvent({ type: 'chat.text', id: 'c', text: 'x' })).toBe(false);
    expect(isTerminalEvent({ type: 'chat.done', id: 'c', status: 'completed' })).toBe(true);
    expect(isTerminalEvent({ type: 'error', error: { code: 'internal', message: 'm' } })).toBe(
      true,
    );
  });
});

describe('providers (protocol v4)', () => {
  it('parses a chat request with a provider and key, and rejects unknown providers', () => {
    const base = {
      type: 'chat',
      id: 'c1',
      messages: [{ role: 'user', content: 'hi' }],
      tools: 'off',
    };
    const ok = parseRequest(JSON.stringify({ ...base, provider: 'xai', apiKey: 'xai-secret' }));
    expect(ok).toMatchObject({ ok: true, value: { provider: 'xai', apiKey: 'xai-secret' } });
    expect(parseRequest(JSON.stringify({ ...base, provider: 'skynet' })).ok).toBe(false);
    expect(parseRequest(JSON.stringify({ ...base, apiKey: 7 })).ok).toBe(false);
  });

  it('parses providers and provider.login requests', () => {
    expect(parseRequest('{"type":"providers","id":"p1","hasKey":["xai"]}')).toEqual({
      ok: true,
      value: { type: 'providers', id: 'p1', hasKey: ['xai'] },
    });
    expect(parseRequest('{"type":"providers","id":"p1","hasKey":["nope"]}').ok).toBe(false);
    expect(parseRequest('{"type":"provider.login","id":"l1","provider":"openai"}')).toEqual({
      ok: true,
      value: { type: 'provider.login', id: 'l1', provider: 'openai' },
    });
    expect(parseRequest('{"type":"provider.login","id":"l1","provider":"x"}').ok).toBe(false);
  });

  it('round-trips a providers.report event', () => {
    const event = {
      type: 'providers.report' as const,
      id: 'p1',
      providers: [
        {
          id: 'claude' as const,
          name: 'Claude',
          authMethods: ['subscription' as const],
          auth: 'signed_in' as const,
          authVia: 'subscription' as const,
          models: [{ id: 'default', label: 'Default' }],
          note: 'ok',
        },
      ],
    };
    expect(parseEvent(JSON.stringify(event))).toEqual({ ok: true, value: event });
    expect(parseEvent('{"type":"providers.report","id":"p1","providers":[{"id":"zzz"}]}').ok).toBe(
      false,
    );
  });
});

describe('protocol 5: custom models', () => {
  const chat = (extra: Record<string, unknown>) =>
    parseRequest(
      JSON.stringify({
        type: 'chat',
        id: 'c1',
        tools: 'off',
        messages: [{ role: 'user', content: 'hi' }],
        ...extra,
      }),
    );

  it('is version 5 and knows the two new providers', () => {
    expect(PROTOCOL_VERSION).toBe(5);
    expect(PROVIDER_IDS).toEqual(['claude', 'openai', 'xai', 'huggingface', 'local']);
  });

  it('still parses a version-4 chat unchanged', () => {
    expect(chat({ provider: 'xai', apiKey: 'k', model: 'grok-4.7' })).toEqual({
      ok: true,
      value: {
        type: 'chat',
        id: 'c1',
        tools: 'off',
        messages: [{ role: 'user', content: 'hi' }],
        provider: 'xai',
        apiKey: 'k',
        model: 'grok-4.7',
      },
    });
  });

  it('accepts validated params and a loopback base URL', () => {
    const parsed = chat({
      provider: 'local',
      model: 'llama3.2:1b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      params: { temperature: 0.2, maxTokens: 256, stop: ['</s>'] },
    });
    expect(parsed).toMatchObject({
      ok: true,
      value: { baseUrl: 'http://127.0.0.1:11434/v1', params: { temperature: 0.2, maxTokens: 256 } },
    });
  });

  it('refuses bad params and a remote base URL unless remote servers are allowed', () => {
    expect(chat({ params: { temperature: 9 } }).ok).toBe(false);
    expect(chat({ baseUrl: 'http://192.168.1.5:11434/v1' }).ok).toBe(false);
    expect(chat({ baseUrl: 'http://192.168.1.5:11434/v1', allowRemote: true }).ok).toBe(true);
    expect(chat({ baseUrl: 'ftp://x', allowRemote: true }).ok).toBe(false);
    expect(chat({ baseUrl: 'http://u:p@127.0.0.1:1/v1' }).ok).toBe(false);
    expect(chat({ allowRemote: 'yes' }).ok).toBe(false);
  });

  it('parses local.run requests', () => {
    expect(
      parseRequest(
        JSON.stringify({
          type: 'local.run',
          id: 'r1',
          runtime: 'ollama',
          source: { kind: 'hf', repo: 'bartowski/Llama-3.2-1B-Instruct-GGUF', quant: 'Q4_K_M' },
        }),
      ),
    ).toMatchObject({ ok: true, value: { type: 'local.run', runtime: 'ollama' } });
    expect(
      parseRequest(JSON.stringify({ type: 'local.run', id: 'r1', runtime: 'ollama', source: {} }))
        .ok,
    ).toBe(false);
  });

  it('carries runtime statuses in a providers report and drops bad ones', () => {
    const line = JSON.stringify({
      type: 'providers.report',
      id: 'p1',
      providers: [
        {
          id: 'local',
          name: 'On this Mac',
          authMethods: [],
          auth: 'signed_in',
          models: [],
          note: '',
          runtimes: [
            {
              id: 'ollama',
              installed: true,
              running: false,
              baseUrl: 'http://127.0.0.1:11434/v1',
              models: [],
            },
            { id: 'bogus' },
          ],
        },
      ],
    });
    const parsed = parseEvent(line);
    expect(
      parsed.ok && parsed.value.type === 'providers.report' && parsed.value.providers[0]?.runtimes,
    ).toEqual([
      {
        id: 'ollama',
        installed: true,
        running: false,
        baseUrl: 'http://127.0.0.1:11434/v1',
        models: [],
      },
    ]);
  });
});
