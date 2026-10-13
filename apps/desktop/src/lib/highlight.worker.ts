/// <reference lib="webworker" />
import { highlightCode, preload, type HighlightedLines } from './highlight-core';

/** Messages between the app and the highlighter worker. */
export type WorkerRequest =
  | { type: 'highlight'; id: number; channel: string; code: string; language: string }
  | { type: 'preload' };
export type WorkerResponse = { id: number; tokens: HighlightedLines | null };

/**
 * Tokenizing is CPU-heavy (a long block costs tens of milliseconds, and a
 * streaming reply asks again on every pause), so it runs here instead of on the
 * UI thread. Requests are queued per channel (one channel per code block); when
 * a newer request for a channel arrives while an older one is still waiting, the
 * older one is answered with `null` instead of being computed, since its text is
 * already stale.
 */
const pending = new Map<string, Extract<WorkerRequest, { type: 'highlight' }>>();
let running = false;

async function drain(): Promise<void> {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const next = pending.entries().next();
      if (next.done) break;
      const [channel, request] = next.value;
      pending.delete(channel);
      const tokens = await highlightCode(request.code, request.language);
      const response: WorkerResponse = { id: request.id, tokens };
      self.postMessage(response);
    }
  } finally {
    running = false;
  }
}

self.onmessage = (event: MessageEvent<WorkerRequest>) => {
  const message = event.data;
  if (message.type === 'preload') {
    void preload().catch(() => undefined);
    return;
  }
  const superseded = pending.get(message.channel);
  if (superseded) self.postMessage({ id: superseded.id, tokens: null } satisfies WorkerResponse);
  pending.set(message.channel, message);
  void drain();
};
