import type { SDKMessage } from '@anthropic-ai/claude-agent-sdk';
import type { BridgeEvent } from '@command-center/protocol';
import type { QueryFn } from './sdk';

/** Builders for SDK messages. Only the fields the bridge reads are filled in. */
export const sdk = {
  init: (model = 'test-model') =>
    ({ type: 'system', subtype: 'init', model }) as unknown as SDKMessage,
  start: (id = 'msg_1') =>
    ({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'message_start', message: { id } },
    }) as unknown as SDKMessage,
  delta: (text: string) =>
    ({
      type: 'stream_event',
      parent_tool_use_id: null,
      event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text } },
    }) as unknown as SDKMessage,
  assistant: (content: unknown[], id = 'msg_1', error?: string) =>
    ({
      type: 'assistant',
      parent_tool_use_id: null,
      message: { id, content },
      ...(error ? { error } : {}),
    }) as unknown as SDKMessage,
  toolResult: (toolUseId: string, isError = false) =>
    ({
      type: 'user',
      parent_tool_use_id: null,
      message: { content: [{ type: 'tool_result', tool_use_id: toolUseId, is_error: isError }] },
    }) as unknown as SDKMessage,
  rateLimit: (info: Record<string, unknown>) =>
    ({ type: 'rate_limit_event', rate_limit_info: info }) as unknown as SDKMessage,
  success: (over: Record<string, unknown> = {}) =>
    ({
      type: 'result',
      subtype: 'success',
      is_error: false,
      duration_ms: 12,
      total_cost_usd: 0.5,
      usage: {
        input_tokens: 1,
        cache_creation_input_tokens: 1,
        cache_read_input_tokens: 1,
        output_tokens: 4,
      },
      ...over,
    }) as unknown as SDKMessage,
  failure: (result: string, subtype = 'success') =>
    ({
      type: 'result',
      subtype,
      is_error: true,
      result,
      errors: [result],
      duration_ms: 1,
      usage: { input_tokens: 0, output_tokens: 0 },
    }) as unknown as SDKMessage,
};

/** A query that yields a fixed script. */
export function scripted(messages: SDKMessage[]): QueryFn {
  return () =>
    (async function* () {
      for (const m of messages) yield m;
    })();
}

/** Collects emitted events; `types` is handy for compact assertions. */
export function collector() {
  const events: BridgeEvent[] = [];
  return {
    events,
    emit: (e: BridgeEvent) => void events.push(e),
    get types() {
      return events.map((e) => e.type);
    },
  };
}
