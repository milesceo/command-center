import {
  highlightCode as highlightLocally,
  isHighlightable,
  preload,
  type HighlightedLines,
  type ThemedToken,
} from './highlight-core';
import type { WorkerRequest, WorkerResponse } from './highlight.worker';

export type { HighlightedLines, ThemedToken };
export { isHighlightable };

/**
 * Syntax highlighting entry point. Tokenizing runs in a Web Worker so a code
 * block, even a long one that is re-highlighted while it streams, never blocks
 * typing or scrolling. Where workers are unavailable (unit tests) or the worker
 * fails, the same code runs on the calling thread.
 */

interface Waiting {
  resolve: (tokens: HighlightedLines | null) => void;
  /** Used if the worker dies before answering. */
  retry: () => Promise<HighlightedLines | null>;
}

let worker: Worker | null | undefined;
let nextId = 1;
const waiting = new Map<number, Waiting>();

function failWorker(): void {
  worker?.terminate();
  worker = null;
  const stranded = [...waiting.values()];
  waiting.clear();
  for (const w of stranded) void w.retry().then(w.resolve);
}

function getWorker(): Worker | null {
  if (worker !== undefined) return worker;
  if (typeof Worker === 'undefined') return (worker = null);
  try {
    const created = new Worker(new URL('./highlight.worker.ts', import.meta.url), {
      type: 'module',
    });
    created.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const entry = waiting.get(event.data.id);
      if (!entry) return;
      waiting.delete(event.data.id);
      entry.resolve(event.data.tokens);
    };
    created.onerror = () => failWorker();
    return (worker = created);
  } catch {
    return (worker = null);
  }
}

/**
 * Tokenizes `code`. Resolves null when the language is unknown, fails to load,
 * or the request was superseded by a newer one on the same `channel` (callers
 * ignore stale results anyway), so callers fall back to plain text.
 */
export function highlightCode(
  code: string,
  language: string,
  channel = 'default',
): Promise<HighlightedLines | null> {
  if (!isHighlightable(language)) return Promise.resolve(null);
  const w = getWorker();
  if (!w) return highlightLocally(code, language);
  return new Promise((resolve) => {
    const id = nextId++;
    waiting.set(id, { resolve, retry: () => highlightLocally(code, language) });
    const request: WorkerRequest = { type: 'highlight', id, channel, code, language };
    w.postMessage(request);
  });
}

/** Starts the worker and fetches the engine and common grammars while the app is idle. */
export function warmUpHighlighter(): void {
  const run = () => {
    const w = getWorker();
    if (w) w.postMessage({ type: 'preload' } satisfies WorkerRequest);
    else void preload().catch(() => undefined);
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 800);
}
