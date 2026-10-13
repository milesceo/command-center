import { DEFAULT_SETTINGS, type ConversationSettings, type Message } from './types';

/** Builders with every field filled in, so tests only state what they care about. */
export function message(over: Partial<Message> = {}): Message {
  return {
    id: crypto.randomUUID(),
    conversationId: 'c',
    role: 'user',
    content: 'hello',
    attachments: [],
    status: 'complete',
    error: null,
    model: null,
    inputTokens: null,
    outputTokens: null,
    cacheReadTokens: null,
    cacheCreationTokens: null,
    costUsd: null,
    createdAt: 1,
    ...over,
  };
}

export function settings(over: Partial<ConversationSettings> = {}): ConversationSettings {
  return { ...DEFAULT_SETTINGS, ...over };
}
