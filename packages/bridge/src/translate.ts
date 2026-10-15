import type {
  SDKAssistantMessageError,
  SDKMessage,
  SDKRateLimitInfo,
} from '@anthropic-ai/claude-agent-sdk';
import type { BridgeError, BridgeEvent } from '@geeked/protocol';
import { fromAssistantError, fromFailureText, normalizeResetsAt } from './errors';
import { usageFromResult, windowsFromRateLimitInfo } from './usage';

/** Per-chat bookkeeping that spans several SDK messages. */
export interface TurnState {
  /** Assistant message ids whose text already arrived as stream deltas. */
  streamed: Set<string>;
  model?: string;
  pendingError?: SDKAssistantMessageError;
  limit?: SDKRateLimitInfo;
  authError?: string;
}

export function newTurnState(): TurnState {
  return { streamed: new Set() };
}

/** Loose shape of content blocks; the SDK's Beta types are far wider than we need. */
interface Block {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: unknown;
  tool_use_id?: string;
  is_error?: boolean;
}

function blocksOf(content: unknown): Block[] {
  return Array.isArray(content) ? (content as Block[]) : [];
}

const SUMMARY_KEYS = ['file_path', 'path', 'pattern', 'command', 'url', 'query'];

/** One short line describing a tool call; the raw input may be huge or sensitive. */
export function summarizeToolInput(input: unknown): string {
  if (typeof input !== 'object' || input === null) return '';
  const record = input as Record<string, unknown>;
  for (const key of SUMMARY_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.length > 0) {
      return value.length > 120 ? `${value.slice(0, 117)}...` : value;
    }
  }
  return '';
}

function terminalError(state: TurnState, fallbackText: string): BridgeError {
  if (state.pendingError) return fromAssistantError(state.pendingError, state.limit);
  if (state.authError) return fromFailureText(state.authError, state.limit);
  return fromFailureText(fallbackText, state.limit);
}

/**
 * Translate one SDK message into zero or more protocol events for chat `id`.
 * Pure apart from mutating `state`, so it is easy to test with fixtures.
 * Sub-agent traffic (parent_tool_use_id set) is ignored: plain chat has none.
 */
export function translateMessage(msg: SDKMessage, state: TurnState, id: string): BridgeEvent[] {
  switch (msg.type) {
    case 'system':
      if (msg.subtype === 'init') state.model = msg.model;
      return [];

    case 'auth_status':
      if (msg.error) state.authError = msg.error;
      return [];

    case 'rate_limit_event': {
      const info = msg.rate_limit_info;
      // Plan windows ride along on every rate-limit event, including the routine "allowed" ones.
      const events: BridgeEvent[] = [];
      const windows = windowsFromRateLimitInfo(info);
      if (windows.length > 0) events.push({ type: 'chat.limits', id, windows });
      if (info.status === 'allowed') return events;
      state.limit = info;
      const event: BridgeEvent = { type: 'chat.rate_limit', id, status: info.status };
      if (info.rateLimitType) event.limitType = info.rateLimitType;
      const resetsAt = normalizeResetsAt(info.resetsAt);
      if (resetsAt !== undefined) event.resetsAt = resetsAt;
      if (info.utilization !== undefined) event.utilization = info.utilization;
      return [...events, event];
    }

    case 'stream_event': {
      if (msg.parent_tool_use_id) return [];
      const e = msg.event;
      if (e.type === 'message_start') {
        state.streamed.add(e.message.id);
        return [];
      }
      if (e.type === 'content_block_delta' && e.delta.type === 'text_delta') {
        return [{ type: 'chat.text', id, text: e.delta.text }];
      }
      return [];
    }

    case 'assistant': {
      if (msg.parent_tool_use_id) return [];
      if (msg.error) {
        // The message body is the runtime's own error prose; we show our copy instead.
        state.pendingError = msg.error;
        return [];
      }
      const events: BridgeEvent[] = [];
      for (const block of blocksOf(msg.message.content)) {
        if (block.type === 'text' && block.text && !state.streamed.has(msg.message.id)) {
          events.push({ type: 'chat.text', id, text: block.text });
        } else if (block.type === 'tool_use' && block.id && block.name) {
          events.push({
            type: 'chat.tool_use',
            id,
            toolUseId: block.id,
            name: block.name,
            summary: summarizeToolInput(block.input),
          });
        }
      }
      return events;
    }

    case 'user': {
      if (msg.parent_tool_use_id) return [];
      const content = (msg.message as { content?: unknown }).content;
      return blocksOf(content)
        .filter((b) => b.type === 'tool_result' && b.tool_use_id)
        .map((b) => ({
          type: 'chat.tool_result' as const,
          id,
          toolUseId: b.tool_use_id as string,
          isError: b.is_error === true,
        }));
    }

    case 'result': {
      if (msg.subtype === 'success' && !msg.is_error) {
        const done: BridgeEvent = {
          type: 'chat.done',
          id,
          status: 'completed',
          usage: usageFromResult(msg, state.model),
          durationMs: msg.duration_ms,
        };
        if (state.model) done.model = state.model;
        return [done];
      }
      const detail =
        msg.subtype === 'success'
          ? msg.result
          : msg.errors.join('\n') || `Run ended: ${msg.subtype}`;
      return [{ type: 'error', id, error: terminalError(state, detail) }];
    }

    default:
      return [];
  }
}
