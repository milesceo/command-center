import { describe, expect, it } from 'vitest';
import { applyEvent, newRun, testRequest, tokensPerSecond } from './model-test';
import type { CustomModel } from './repo-models';

const model = (over: Partial<CustomModel> = {}): CustomModel => ({
  id: 'm1',
  provider: 'local',
  model: 'qwen2.5:0.5b',
  displayName: 'Qwen',
  hfRepo: null,
  runtime: 'ollama',
  baseUrl: 'http://127.0.0.1:11434/v1',
  quant: null,
  filePath: null,
  adapterPath: null,
  systemPrompt: null,
  params: {},
  tags: [],
  createdAt: 0,
  updatedAt: 0,
  ...over,
});

const usage = (input: number, output: number) => ({
  inputTokens: input,
  outputTokens: output,
  cacheReadTokens: 0,
  cacheCreationTokens: 0,
  models: [],
});

describe('applyEvent', () => {
  it('measures time to first text, total time and the reported tokens', () => {
    let run = newRun('m1');
    run = applyEvent(run, { type: 'chat.text', id: 'x', text: '' }, 50);
    expect(run.ttftMs).toBeNull();
    run = applyEvent(run, { type: 'chat.text', id: 'x', text: 'Hel' }, 120);
    run = applyEvent(run, { type: 'chat.text', id: 'x', text: 'lo' }, 300);
    run = applyEvent(
      run,
      { type: 'chat.done', id: 'x', status: 'completed', usage: usage(12, 21) },
      1120,
    );
    expect(run).toMatchObject({
      status: 'done',
      text: 'Hello',
      ttftMs: 120,
      totalMs: 1120,
      inputTokens: 12,
      outputTokens: 21,
    });
    expect(tokensPerSecond(run)).toBeCloseTo(20);
  });

  it('records a stop and an error, and gives no speed without reported usage', () => {
    const stopped = applyEvent(newRun('m'), { type: 'chat.done', id: 'x', status: 'cancelled' }, 9);
    expect(stopped.status).toBe('stopped');
    expect(tokensPerSecond(stopped)).toBeNull();
    const failed = applyEvent(
      newRun('m'),
      { type: 'error', id: 'x', error: { code: 'auth_required', message: 'no key' } },
      5,
    );
    expect(failed).toMatchObject({ status: 'error', error: { code: 'auth_required' } });
  });
});

describe('testRequest', () => {
  it('sends the local server, presets and system prompt, never a key', () => {
    const req = testRequest(
      model({ params: { temperature: 0.2 }, systemPrompt: 'Be brief.' }),
      'Hi',
      { apiKey: 'secret', allowRemote: false },
    );
    expect(req).toEqual({
      messages: [{ role: 'user', content: 'Hi' }],
      tools: 'off',
      provider: 'local',
      model: 'qwen2.5:0.5b',
      systemPrompt: 'Be brief.',
      params: { temperature: 0.2 },
      baseUrl: 'http://127.0.0.1:11434/v1',
    });
  });

  it('attaches the key for Hugging Face and the remote flag only for local', () => {
    const hf = testRequest(
      model({ provider: 'huggingface', model: 'a/b', runtime: null, baseUrl: null }),
      'Hi',
      { apiKey: 'k', allowRemote: true },
    );
    expect(hf).toMatchObject({ provider: 'huggingface', apiKey: 'k' });
    expect(hf).not.toHaveProperty('allowRemote');
    expect(testRequest(model(), 'Hi', { apiKey: null, allowRemote: true })).toMatchObject({
      allowRemote: true,
    });
  });
});
