import { describe, expect, it } from 'vitest';
import type { ChatRequest } from '@programish/protocol';
import { runChat } from './chat';
import type { QueryFn } from './sdk';
import { collector, scripted, sdk } from './testing';

const request: ChatRequest = {
  type: 'chat',
  id: 'c1',
  messages: [{ role: 'user', content: 'hi' }],
  tools: 'off',
};

describe('runChat', () => {
  it('streams a reply then completes', async () => {
    const out = collector();
    await runChat(
      {
        query: scripted([sdk.init(), sdk.start(), sdk.delta('hi'), sdk.success()]),
        emit: out.emit,
      },
      request,
      new AbortController(),
    );
    expect(out.types).toEqual(['chat.text', 'chat.done']);
  });

  it('cancels promptly even while the runtime is blocked waiting', async () => {
    const out = collector();
    const controller = new AbortController();
    let returned = false;
    const hanging: QueryFn = () => ({
      [Symbol.asyncIterator]: () => ({
        next: () => new Promise<never>(() => {}),
        return: () => {
          returned = true;
          return Promise.resolve({ done: true as const, value: undefined });
        },
      }),
    });
    const run = runChat({ query: hanging, emit: out.emit }, request, controller);
    controller.abort();
    await run;
    expect(out.events).toEqual([{ type: 'chat.done', id: 'c1', status: 'cancelled' }]);
    expect(returned).toBe(true);
  });

  it('stops after a mid-stream cancel and emits no further text', async () => {
    const out = collector();
    const controller = new AbortController();
    const query: QueryFn = () =>
      (async function* () {
        yield sdk.start();
        yield sdk.delta('one');
        controller.abort();
        yield sdk.delta('two');
        yield sdk.success();
      })();
    await runChat({ query, emit: out.emit }, request, controller);
    expect(out.events.map((e) => e.type)).toEqual(['chat.text', 'chat.done']);
    expect(out.events[1]).toMatchObject({ status: 'cancelled' });
  });

  it('turns a thrown error into a single error event', async () => {
    const out = collector();
    const query: QueryFn = () =>
      (async function* () {
        yield sdk.delta('partial');
        throw new Error('Claude Code process exited with code 1');
      })();
    await runChat({ query, emit: out.emit }, request, new AbortController());
    expect(out.types).toEqual(['chat.text', 'error']);
  });

  it('uses captured stderr to explain a crashed runtime', async () => {
    const out = collector();
    const query: QueryFn = (params) =>
      (async function* () {
        params.options?.stderr?.('Error: Not logged in\n');
        throw new Error('Claude Code process exited with code 1');
        yield sdk.success();
      })();
    await runChat({ query, emit: out.emit }, request, new AbortController());
    expect(out.events[0]).toMatchObject({ type: 'error', error: { code: 'auth_required' } });
  });

  it('reports a stream that ends without a result', async () => {
    const out = collector();
    await runChat(
      { query: scripted([sdk.delta('x')]), emit: out.emit },
      request,
      new AbortController(),
    );
    expect(out.types).toEqual(['chat.text', 'error']);
  });

  it('never throws even if the query factory does', async () => {
    const out = collector();
    const query: QueryFn = () => {
      throw new Error('spawn claude ENOENT');
    };
    await runChat({ query, emit: out.emit }, request, new AbortController());
    expect(out.events[0]).toMatchObject({ type: 'error', error: { code: 'sdk_unavailable' } });
  });
});
