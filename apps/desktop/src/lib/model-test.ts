import type { BridgeError, BridgeEvent, ChatRequest } from '@command-center/protocol';
import type { CustomModel } from './repo-models';

/** What one model did with the test prompt. Times are milliseconds. */
export interface TestRun {
  modelId: string;
  /** The prompt this run answered (kept so saving pairs the reply with its own question). */
  prompt: string;
  status: 'running' | 'done' | 'stopped' | 'error';
  text: string;
  /** Time from sending to the first piece of text. */
  ttftMs: number | null;
  totalMs: number | null;
  /** Tokens the server reported (input + output), when it reported any. */
  inputTokens: number | null;
  outputTokens: number | null;
  error: BridgeError | null;
}

export const newRun = (modelId: string, prompt = ''): TestRun => ({
  modelId,
  prompt,
  status: 'running',
  text: '',
  ttftMs: null,
  totalMs: null,
  inputTokens: null,
  outputTokens: null,
  error: null,
});

/**
 * Output tokens per second after the first token, from the server's own token count. Null when
 * the server reported no usage or the reply was too quick to measure: never an estimate.
 */
export function tokensPerSecond(run: TestRun): number | null {
  if (run.outputTokens === null || run.totalMs === null || run.ttftMs === null) return null;
  const seconds = (run.totalMs - run.ttftMs) / 1000;
  if (seconds <= 0.05 || run.outputTokens <= 1) return null;
  return (run.outputTokens - 1) / seconds;
}

/** The chat request for one test prompt against a Model Lab model. */
export function testRequest(
  model: CustomModel,
  prompt: string,
  opts: { apiKey: string | null; allowRemote: boolean },
): Omit<ChatRequest, 'type' | 'id'> {
  return {
    messages: [{ role: 'user', content: prompt }],
    tools: 'off',
    provider: model.provider,
    model: model.model,
    ...(opts.apiKey && model.provider === 'huggingface' ? { apiKey: opts.apiKey } : {}),
    ...(model.systemPrompt ? { systemPrompt: model.systemPrompt } : {}),
    ...(Object.keys(model.params).length > 0 ? { params: model.params } : {}),
    ...(model.provider === 'local' && model.baseUrl ? { baseUrl: model.baseUrl } : {}),
    ...(model.provider === 'local' && opts.allowRemote ? { allowRemote: true } : {}),
  };
}

/**
 * Folds one bridge event into a run. `elapsed` is the time since the prompt was sent. Pure, so
 * the measurements are tested without a bridge.
 */
export function applyEvent(run: TestRun, event: BridgeEvent, elapsed: number): TestRun {
  switch (event.type) {
    case 'chat.text':
      return {
        ...run,
        text: run.text + event.text,
        ttftMs: run.ttftMs ?? (event.text ? elapsed : null),
      };
    case 'chat.done': {
      const usage = event.usage;
      return {
        ...run,
        status: event.status === 'cancelled' ? 'stopped' : 'done',
        totalMs: elapsed,
        inputTokens: usage ? usage.inputTokens + usage.cacheReadTokens : null,
        outputTokens: usage && usage.outputTokens > 0 ? usage.outputTokens : null,
      };
    }
    case 'error':
      return { ...run, status: 'error', totalMs: elapsed, error: event.error };
    default:
      return run;
  }
}
