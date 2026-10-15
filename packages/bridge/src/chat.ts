import type { BridgeError, BridgeEvent, ChatRequest } from '@geeked/protocol';
import { fromThrown } from './errors';
import { buildOptions } from './options';
import { buildPrompt } from './prompt';
import type { QueryFn } from './sdk';
import { newTurnState, translateMessage } from './translate';

const STDERR_TAIL_CHARS = 2000;

export interface ChatDeps {
  query: QueryFn;
  emit: (event: BridgeEvent) => void;
}

/**
 * Runs one chat request to completion, emitting protocol events. Always ends
 * with exactly one terminal event (`chat.done` or `error`) and never throws.
 * Aborting `controller` stops the run promptly even if the SDK is mid-wait.
 */
export async function runChat(
  deps: ChatDeps,
  request: ChatRequest,
  controller: AbortController,
): Promise<void> {
  const { id } = request;
  const state = newTurnState();
  let stderrTail = '';
  let finished = false;

  const finish = (event: BridgeEvent) => {
    if (finished) return;
    finished = true;
    deps.emit(event);
  };
  const cancelled = (): BridgeEvent => ({ type: 'chat.done', id, status: 'cancelled' });
  const fail = (error: BridgeError): BridgeEvent => ({ type: 'error', id, error });

  const aborted = new Promise<'aborted'>((resolve) => {
    if (controller.signal.aborted) resolve('aborted');
    controller.signal.addEventListener('abort', () => resolve('aborted'), { once: true });
  });

  let iterator: AsyncIterator<unknown> | undefined;
  try {
    const stream = deps.query({
      prompt: buildPrompt(request.messages),
      options: buildOptions(request, controller, (data) => {
        stderrTail = (stderrTail + data).slice(-STDERR_TAIL_CHARS);
      }),
    });
    const it = stream[Symbol.asyncIterator]();
    iterator = it;

    while (!finished) {
      const next = await Promise.race([it.next(), aborted]);
      if (next === 'aborted' || controller.signal.aborted) {
        finish(cancelled());
        break;
      }
      if (next.done) break;
      for (const event of translateMessage(next.value, state, id)) {
        deps.emit(event);
        if (event.type === 'chat.done' || event.type === 'error') finished = true;
      }
    }

    if (!finished) {
      finish(
        fail(
          fromThrown(
            new Error('The Claude runtime ended without producing a result.'),
            stderrTail,
            state.limit,
          ),
        ),
      );
    }
  } catch (err) {
    finish(
      controller.signal.aborted ? cancelled() : fail(fromThrown(err, stderrTail, state.limit)),
    );
  } finally {
    // Release the runtime process; never let cleanup failures surface.
    void iterator?.return?.().catch(() => undefined);
  }
}
