import type {
  Attachment,
  BridgeError,
  ChatParams,
  ProviderId,
  ToolsMode,
} from '@command-center/protocol';

/** Per-conversation knobs; also used for the not-yet-created "new chat" draft. */
export interface ConversationSettings {
  /** Which provider answers this chat. */
  provider: ProviderId;
  /** Model alias; null lets the runtime choose. */
  model: string | null;
  /** A custom system prompt written for this conversation. Wins over the library prompt and the project default. */
  systemPrompt: string | null;
  /** A library system prompt attached to this conversation (used when there is no custom text). */
  systemPromptId: string | null;
  /** Values for the attached prompt's {{variables}}. */
  systemPromptVars: Record<string, string>;
  toolsMode: ToolsMode;
  /** Working directory for read-only tools. */
  cwd: string | null;
  projectId: string | null;
  /** This chat's overrides of its Model Lab model's presets; null uses the model's own. */
  modelParams: ChatParams | null;
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
  /** Uncached input tokens (rows written before cache accounting include cached tokens here). */
  inputTokens: number | null;
  outputTokens: number | null;
  cacheReadTokens: number | null;
  cacheCreationTokens: number | null;
  /** The SDK's API-equivalent price for this reply; informational on a subscription. Null when not reported. */
  costUsd: number | null;
  createdAt: number;
}

export type PromptKind = 'prompt' | 'system';

export interface Prompt {
  id: string;
  kind: PromptKind;
  title: string;
  body: string;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  name: string;
  defaultSystemPromptId: string | null;
  defaultSystemPromptVars: Record<string, string>;
  createdAt: number;
  updatedAt: number;
}

export const DEFAULT_TITLE = 'New chat';

export const DEFAULT_SETTINGS: ConversationSettings = {
  provider: 'claude',
  model: null,
  systemPrompt: null,
  systemPromptId: null,
  systemPromptVars: {},
  toolsMode: 'off',
  cwd: null,
  projectId: null,
  modelParams: null,
};
