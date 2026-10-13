import { tmpdir } from 'node:os';
import type { BridgeEvent } from '@programish/protocol';
import { fromThrown } from './errors';
import { DEFAULT_SYSTEM_PROMPT, runtimeEnv } from './options';
import type { QueryFn } from './sdk';
import { reportFromUsage } from './usage';

const TIMEOUT_MS = 25_000;

/**
 * Reads the plan usage windows through the SDK's experimental `/usage` control
 * request. That request needs a live runtime process but no conversation, so a
 * query whose prompt never arrives is opened, asked, and torn down again
 * (about 1.5 s). Always answers with exactly one event; never throws.
 */
export async function runUsage(
  deps: { query: QueryFn; emit: (event: BridgeEvent) => void },
  id: string,
  timeoutMs = TIMEOUT_MS,
): Promise<void> {
  const controller = new AbortController();
  const fail = (message: string, err?: unknown) =>
    deps.emit({
      type: 'error',
      id,
      error: err === undefined ? { code: 'internal', message } : { ...fromThrown(err), message },
    });

  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    // An input stream that never produces a message; it ends when we abort.
    const prompt: AsyncIterable<never> = {
      [Symbol.asyncIterator]: () => ({
        next: () =>
          new Promise<IteratorResult<never>>((resolve) =>
            controller.signal.addEventListener(
              'abort',
              () => resolve({ done: true, value: undefined }),
              { once: true },
            ),
          ),
      }),
    };
    const q = deps.query({
      prompt,
      options: {
        abortController: controller,
        persistSession: false,
        settingSources: [],
        tools: [],
        maxTurns: 1,
        cwd: tmpdir(),
        systemPrompt: DEFAULT_SYSTEM_PROMPT,
        env: runtimeEnv(process.env),
      },
    });
    if (typeof q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET !== 'function') {
      fail('This version of the Claude SDK does not expose plan usage.');
      return;
    }
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('Timed out reading plan usage.')), timeoutMs);
    });
    const response = await Promise.race([
      q.usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET({ skipBehaviors: true }),
      timeout,
    ]);
    deps.emit(reportFromUsage(id, response));
  } catch (err) {
    fail(err instanceof Error ? err.message : String(err), err);
  } finally {
    clearTimeout(timer);
    controller.abort();
  }
}
