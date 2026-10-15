import type { Attachment, BridgeError, BridgeEvent, ChatRequest } from '@geeked/protocol';
import { createStore, useStore } from 'zustand';
import type { BridgeClient, ChatHandle } from '../lib/bridge';
import { getBridgeClient } from '../lib/bridge-client';
import { getDb, type Db } from '../lib/db';
import * as repo from '../lib/repo';
import * as projectsRepo from '../lib/repo-projects';
import * as promptsRepo from '../lib/repo-prompts';
import * as usageRepo from '../lib/repo-usage';
import { resolveSystemPrompt } from '../lib/system-prompt';
import type { Conversation, Message } from '../lib/types';
import { useBridgeStore } from './bridge';
import { conversationsStore, titleFrom } from './conversations';
import { usageStore } from './usage';

export interface ToolActivity {
  toolUseId: string;
  name: string;
  summary: string;
  status: 'running' | 'done' | 'error';
}

export interface RateLimitNotice {
  status: 'allowed_warning' | 'rejected';
  limitType?: string;
  resetsAt?: number;
  utilization?: number;
}

/** A reply that is still arriving. It becomes a stored Message when the stream ends. */
export interface StreamState {
  /** Id the reply will be stored under, so anything keyed to it (a live preview) survives the hand-off. */
  messageId: string;
  requestId: string;
  text: string;
  tools: ToolActivity[];
  rateLimit: RateLimitNotice | null;
  startedAt: number;
}

export interface ChatState {
  /** Conversation whose messages are in `messages` (null = draft). */
  loadedFor: string | null;
  messages: Message[];
  streams: Record<string, StreamState>;
  /** Last failure per conversation when there was no partial reply to attach it to. */
  errors: Record<string, BridgeError | null>;

  loadMessages: (conversationId: string | null) => Promise<void>;
  send: (text: string, attachments?: Attachment[]) => Promise<void>;
  stop: (conversationId: string) => void;
  /** Re-runs the last turn: drops a trailing assistant reply, or retries after a failed one. */
  regenerate: () => Promise<void>;
  editAndResend: (messageId: string, text: string) => Promise<void>;
  dismissError: (conversationId: string) => void;
}

export interface ChatDeps {
  database: () => Promise<Db>;
  client: () => BridgeClient;
  conversations: typeof conversationsStore;
  usage: typeof usageStore;
  /** Resolves once the sidecar is running; rejects if it cannot start. */
  ensureConnected: () => Promise<void>;
  /**
   * Coalesces rapid text deltas into one store update. `streamedChars` is how much
   * text the reply already has, so long replies can be flushed less often.
   */
  schedule: (flush: () => void, streamedChars: number) => () => void;
}

/** Past this many characters each re-render costs enough that updating every frame stops paying off. */
const SLOW_FLUSH_AFTER_CHARS = 12_000;
const SLOW_FLUSH_MS = 100;

const defaultSchedule: ChatDeps['schedule'] = (flush, streamedChars) => {
  if (streamedChars > SLOW_FLUSH_AFTER_CHARS) {
    const timer = setTimeout(flush, SLOW_FLUSH_MS);
    return () => clearTimeout(timer);
  }
  if (typeof requestAnimationFrame === 'function') {
    const handle = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(handle);
  }
  const timer = setTimeout(flush, 16);
  return () => clearTimeout(timer);
};

const defaultEnsureConnected = async () => {
  await useBridgeStore.getState().connect();
  const { status, error } = useBridgeStore.getState();
  if (status !== 'ready') throw new Error(error ?? 'The Claude bridge is not available.');
};

const errorOf = (err: unknown): BridgeError => ({
  code: 'internal',
  message: err instanceof Error ? err.message : String(err),
});

export function createChatStore(deps: Partial<ChatDeps> = {}) {
  const database = deps.database ?? getDb;
  const client = deps.client ?? getBridgeClient;
  const conversations = deps.conversations ?? conversationsStore;
  const usage = deps.usage ?? usageStore;
  const schedule = deps.schedule ?? defaultSchedule;
  const ensureConnected = deps.ensureConnected ?? defaultEnsureConnected;
  /** Live handles are not state: nothing renders them. */
  const handles = new Map<string, ChatHandle>();

  return createStore<ChatState>()((set, get) => {
    const patchStream = (conversationId: string, patch: (s: StreamState) => StreamState) =>
      set((state) => {
        const current = state.streams[conversationId];
        return current
          ? { streams: { ...state.streams, [conversationId]: patch(current) } }
          : state;
      });

    const removeStream = (conversationId: string) =>
      set((state) => {
        const streams = { ...state.streams };
        delete streams[conversationId];
        return { streams };
      });

    const setError = (conversationId: string, error: BridgeError | null) =>
      set((state) => ({ errors: { ...state.errors, [conversationId]: error } }));

    const append = (message: Message) => {
      if (get().loadedFor === message.conversationId)
        set({ messages: [...get().messages, message] });
    };

    /** One ledger row per model the SDK reported; failures never affect the chat itself. */
    const recordUsage = async (
      conversationId: string,
      messageId: string | null,
      tokens: NonNullable<Extract<BridgeEvent, { type: 'chat.done' }>['usage']>,
    ) => {
      try {
        const createdAt = Date.now();
        await usageRepo.recordUsage(
          await database(),
          tokens.models.map((m) => ({
            id: crypto.randomUUID(),
            createdAt,
            conversationId,
            messageId,
            model: m.model,
            inputTokens: m.inputTokens,
            outputTokens: m.outputTokens,
            cacheReadTokens: m.cacheReadTokens,
            cacheCreationTokens: m.cacheCreationTokens,
            costUsd: m.costUsd ?? null,
          })),
        );
        await usage.getState().refreshConversation(conversationId);
      } catch (err) {
        console.error('[usage] could not record usage', err);
      }
    };

    /** Stores the finished (or stopped/failed) reply and clears the live stream. */
    const finalize = async (
      conversationId: string,
      outcome: {
        status: 'complete' | 'stopped' | 'error';
        error?: BridgeError;
        event?: BridgeEvent;
      },
    ) => {
      const stream = get().streams[conversationId];
      removeStream(conversationId);
      handles.delete(conversationId);
      if (!stream) return;

      const done = outcome.event?.type === 'chat.done' ? outcome.event : undefined;
      const tokens = done?.usage;
      const keepsText = stream.text !== '';

      // Tokens were spent whether or not there is any text to keep, so the ledger is written first.
      if (tokens) await recordUsage(conversationId, keepsText ? stream.messageId : null, tokens);

      if (!keepsText) {
        // Nothing to keep. A failure is shown as a banner instead.
        if (outcome.status === 'error' && outcome.error) setError(conversationId, outcome.error);
        return;
      }
      const message: Message = {
        id: stream.messageId,
        conversationId,
        role: 'assistant',
        content: stream.text,
        attachments: [],
        status: outcome.status,
        error: outcome.error ?? null,
        model: done?.model ?? null,
        inputTokens: tokens?.inputTokens ?? null,
        outputTokens: tokens?.outputTokens ?? null,
        cacheReadTokens: tokens?.cacheReadTokens ?? null,
        cacheCreationTokens: tokens?.cacheCreationTokens ?? null,
        costUsd: tokens?.costUsd ?? null,
        createdAt: Date.now(),
      };
      try {
        await repo.insertMessage(await database(), message);
        append(message);
        await conversations.getState().touch(conversationId);
      } catch (err) {
        // Typically the conversation was deleted while it was streaming.
        setError(conversationId, errorOf(err));
      }
    };

    /** Sends the stored transcript to the bridge and streams the reply into state. */
    const runTurn = async (conversation: Conversation) => {
      const conversationId = conversation.id;
      if (get().streams[conversationId]) return;
      setError(conversationId, null);

      const history = await repo.listMessages(await database(), conversationId);
      const messages = history
        .filter((m) => m.content.trim() !== '' || m.attachments.length > 0)
        .map((m) => ({
          role: m.role,
          content: m.content,
          ...(m.attachments.length > 0 ? { attachments: m.attachments } : {}),
        }));
      if (messages[messages.length - 1]?.role !== 'user') return;

      // Conversation text, else its library prompt, else the project's default (variables rendered now).
      const db = await database();
      const [library, project] = await Promise.all([
        promptsRepo.listPrompts(db),
        conversation.projectId ? projectsRepo.getProject(db, conversation.projectId) : null,
      ]);
      const systemPrompt = resolveSystemPrompt(conversation, project, library).text;

      const request: Omit<ChatRequest, 'type' | 'id'> = {
        messages,
        tools: conversation.toolsMode,
        ...(conversation.model ? { model: conversation.model } : {}),
        ...(systemPrompt ? { systemPrompt } : {}),
        ...(conversation.toolsMode === 'readonly' && conversation.cwd
          ? { cwd: conversation.cwd }
          : {}),
      };

      if (conversation.toolsMode === 'readonly' && !conversation.cwd) {
        setError(conversationId, {
          code: 'invalid_request',
          message:
            'Read-only file access needs a folder. Choose one in the chat settings (sliders icon), or switch file access off.',
        });
        return;
      }

      let buffer = '';
      let cancelFlush: (() => void) | undefined;
      const flush = () => {
        cancelFlush = undefined;
        if (!buffer) return;
        const chunk = buffer;
        buffer = '';
        patchStream(conversationId, (s) => ({ ...s, text: s.text + chunk }));
      };

      const onEvent = (event: BridgeEvent) => {
        switch (event.type) {
          case 'chat.text':
            buffer += event.text;
            cancelFlush ??= schedule(
              flush,
              (get().streams[conversationId]?.text.length ?? 0) + buffer.length,
            );
            break;
          case 'chat.tool_use':
            patchStream(conversationId, (s) => ({
              ...s,
              tools: [
                ...s.tools,
                {
                  toolUseId: event.toolUseId,
                  name: event.name,
                  summary: event.summary,
                  status: 'running',
                },
              ],
            }));
            break;
          case 'chat.tool_result':
            patchStream(conversationId, (s) => ({
              ...s,
              tools: s.tools.map((t) =>
                t.toolUseId === event.toolUseId
                  ? { ...t, status: event.isError ? 'error' : 'done' }
                  : t,
              ),
            }));
            break;
          case 'chat.limits':
            void usage.getState().noteWindows(event.windows);
            break;
          case 'chat.rate_limit':
            patchStream(conversationId, (s) => ({
              ...s,
              rateLimit: {
                status: event.status,
                ...(event.limitType ? { limitType: event.limitType } : {}),
                ...(event.resetsAt !== undefined ? { resetsAt: event.resetsAt } : {}),
                ...(event.utilization !== undefined ? { utilization: event.utilization } : {}),
              },
            }));
            break;
          case 'chat.done':
            cancelFlush?.();
            flush();
            void finalize(conversationId, {
              status: event.status === 'cancelled' ? 'stopped' : 'complete',
              event,
            });
            break;
          case 'error':
            cancelFlush?.();
            flush();
            void finalize(conversationId, { status: 'error', error: event.error });
            break;
          case 'pong':
            break;
        }
      };

      set((state) => ({
        streams: {
          ...state.streams,
          [conversationId]: {
            messageId: crypto.randomUUID(),
            requestId: '',
            text: '',
            tools: [],
            rateLimit: null,
            startedAt: Date.now(),
          },
        },
      }));
      try {
        await ensureConnected();
        const handle = client().chat(request, onEvent);
        handles.set(conversationId, handle);
        patchStream(conversationId, (s) => ({ ...s, requestId: handle.id }));
      } catch (err) {
        removeStream(conversationId);
        setError(conversationId, {
          code: 'sdk_unavailable',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    };

    const requireConversation = async (id: string): Promise<Conversation | null> =>
      repo.getConversation(await database(), id);

    return {
      loadedFor: null,
      messages: [],
      streams: {},
      errors: {},

      loadMessages: async (conversationId) => {
        if (get().loadedFor === conversationId && conversationId !== null) return;
        if (!conversationId) {
          set({ loadedFor: null, messages: [] });
          return;
        }
        const messages = await repo.listMessages(await database(), conversationId);
        // Skip if the user switched away meanwhile, or if send() already populated this
        // conversation (a stale read must never clobber a freshly appended message).
        if (
          conversations.getState().activeId === conversationId &&
          get().loadedFor !== conversationId
        ) {
          set({ loadedFor: conversationId, messages });
        }
      },

      send: async (text, attachments = []) => {
        const content = text.trim();
        if (!content && attachments.length === 0) return;
        const active = conversations.getState().activeId;
        if (active && get().streams[active]) return;

        const conversation = await conversations.getState().ensureActive();
        if (get().streams[conversation.id]) return;
        if (get().loadedFor !== conversation.id) {
          // A brand-new conversation has no history to load.
          const existing = await repo.listMessages(await database(), conversation.id);
          set({ loadedFor: conversation.id, messages: existing });
        }

        const message: Message = {
          id: crypto.randomUUID(),
          conversationId: conversation.id,
          role: 'user',
          content,
          attachments,
          status: 'complete',
          error: null,
          model: null,
          inputTokens: null,
          outputTokens: null,
          cacheReadTokens: null,
          cacheCreationTokens: null,
          costUsd: null,
          createdAt: Date.now(),
        };
        await repo.insertMessage(await database(), message);
        append(message);
        await conversations
          .getState()
          .autoTitle(conversation.id, titleFrom(content || attachments[0]?.name || ''));
        await conversations.getState().touch(conversation.id);
        await runTurn(conversation);
      },

      stop: (conversationId) => {
        handles.get(conversationId)?.cancel();
      },

      regenerate: async () => {
        const conversationId = get().loadedFor;
        if (!conversationId || get().streams[conversationId]) return;
        const last = get().messages[get().messages.length - 1];
        if (!last) return;
        if (last.role === 'assistant') {
          await repo.deleteMessagesFrom(await database(), conversationId, last.id);
          set({ messages: get().messages.slice(0, -1) });
        }
        const conversation = await requireConversation(conversationId);
        if (conversation) await runTurn(conversation);
      },

      editAndResend: async (messageId, text) => {
        const conversationId = get().loadedFor;
        if (!conversationId || get().streams[conversationId]) return;
        const index = get().messages.findIndex((m) => m.id === messageId);
        const original = get().messages[index];
        const content = text.trim();
        if (
          !original ||
          original.role !== 'user' ||
          (!content && original.attachments.length === 0)
        )
          return;

        await repo.deleteMessagesFrom(await database(), conversationId, messageId);
        set({ messages: get().messages.slice(0, index) });
        const edited: Message = {
          ...original,
          id: crypto.randomUUID(),
          content,
          createdAt: Date.now(),
        };
        await repo.insertMessage(await database(), edited);
        append(edited);
        const conversation = await requireConversation(conversationId);
        if (conversation) {
          await conversations.getState().touch(conversationId);
          await runTurn(conversation);
        }
      },

      dismissError: (conversationId) => setError(conversationId, null),
    };
  });
}

export const chatStore = createChatStore();

export function useChat<T>(selector: (state: ChatState) => T): T {
  return useStore(chatStore, selector);
}
