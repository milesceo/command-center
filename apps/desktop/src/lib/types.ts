import type { Attachment, BridgeError, ToolsMode } from '@programish/protocol';

/** Per-conversation knobs; also used for the not-yet-created "new chat" draft. */
export interface ConversationSettings {
  /** Model alias; null lets the runtime choose. */
  model: string | null;
  systemPrompt: string | null;
  toolsMode: ToolsMode;
  /** Working directory for read-only tools. */
  cwd: string | null;
}

export interface Conversation extends ConversationSettings {
  id: string;
  title: string;
  pinned: boolean;
  /** Epoch ms. */
  createdAt: number;
  updatedAt: number;
  /** Search only: true when the title matched (otherwise a message did). */
  titleMatch?: boolean;
}

export type MessageStatus = 'complete' | 'stopped' | 'error';

export interface Message {
  id: string;
  conversationId: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: Attachment[];
  status: MessageStatus;
  error: BridgeError | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  createdAt: number;
}

export const DEFAULT_TITLE = 'New chat';

export const DEFAULT_SETTINGS: ConversationSettings = {
  model: null,
  systemPrompt: null,
  toolsMode: 'off',
  cwd: null,
};
