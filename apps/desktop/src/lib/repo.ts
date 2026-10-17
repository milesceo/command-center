import {
  DEFAULT_PROVIDER,
  PROVIDER_IDS,
  type Attachment,
  type BridgeError,
  type ProviderId,
} from '@command-center/protocol';
import type { Db } from './db';
import {
  DEFAULT_TITLE,
  type Conversation,
  type ConversationSettings,
  type Message,
  type MessageStatus,
} from './types';

/**
 * All SQL lives here. Statements are single, self-contained writes: the SQL
 * plugin pools connections, so we avoid relying on multi-statement transactions.
 * Foreign keys (cascade deletes) are enabled by the plugin's driver.
 */

interface ConversationRow {
  id: string;
  title: string;
  pinned: number;
  model: string | null;
  provider: string | null;
  system_prompt: string | null;
  tools_mode: 'off' | 'readonly';
  cwd: string | null;
  project_id: string | null;
  system_prompt_id: string | null;
  system_prompt_vars: string | null;
  created_at: number;
  updated_at: number;
  title_match?: number;
}

interface MessageRow {
  id: string;
  conversation_id: string;
  role: 'user' | 'assistant';
  content: string;
  attachments: string | null;
  status: MessageStatus;
  error: string | null;
  model: string | null;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_creation_tokens: number | null;
  cost_usd: number | null;
  created_at: number;
}

function toConversation(row: ConversationRow): Conversation {
  const conversation: Conversation = {
    id: row.id,
    title: row.title,
    pinned: row.pinned === 1,
    provider: toProvider(row.provider),
    model: row.model,
    systemPrompt: row.system_prompt,
    systemPromptId: row.system_prompt_id,
    systemPromptVars: parseJson<Record<string, string>>(row.system_prompt_vars, {}),
    toolsMode: row.tools_mode,
    cwd: row.cwd,
    projectId: row.project_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.title_match !== undefined) conversation.titleMatch = row.title_match === 1;
  return conversation;
}

/** Rows written before providers existed (or by a newer build) fall back to the default. */
function toProvider(value: string | null): ProviderId {
  return (PROVIDER_IDS as readonly string[]).includes(value ?? '')
    ? (value as ProviderId)
    : DEFAULT_PROVIDER;
}

/** Variable values are stored as JSON; an empty set is stored as NULL. */
function varsJson(vars: Record<string, string>): string | null {
  return Object.keys(vars).length > 0 ? JSON.stringify(vars) : null;
}

function parseJson<T>(raw: string | null, fallback: T): T {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function toMessage(row: MessageRow): Message {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    role: row.role,
    content: row.content,
    attachments: parseJson<Attachment[]>(row.attachments, []),
    status: row.status,
    error: parseJson<BridgeError | null>(row.error, null),
    model: row.model,
    inputTokens: row.input_tokens,
    outputTokens: row.output_tokens,
    cacheReadTokens: row.cache_read_tokens,
    cacheCreationTokens: row.cache_creation_tokens,
    costUsd: row.cost_usd,
    createdAt: row.created_at,
  };
}

/** Escape LIKE wildcards so a search for "100%" or "a_b" matches literally. */
export function likePattern(query: string): string {
  return `%${query.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}

const ORDER = 'ORDER BY c.pinned DESC, c.updated_at DESC';

/** Lists conversations, pinned first then most recently active; optionally filtered by title or message text. */
export async function listConversations(db: Db, search = ''): Promise<Conversation[]> {
  const query = search.trim();
  if (!query) {
    const rows = await db.select<ConversationRow>(`SELECT c.* FROM conversations c ${ORDER}`);
    return rows.map(toConversation);
  }
  const like = likePattern(query);
  const rows = await db.select<ConversationRow>(
    `SELECT c.*, (c.title LIKE ? ESCAPE '\\') AS title_match
       FROM conversations c
      WHERE c.title LIKE ? ESCAPE '\\'
         OR EXISTS (SELECT 1 FROM messages m
                     WHERE m.conversation_id = c.id AND m.content LIKE ? ESCAPE '\\')
      ${ORDER}`,
    [like, like, like],
  );
  return rows.map(toConversation);
}

export async function getConversation(db: Db, id: string): Promise<Conversation | null> {
  const rows = await db.select<ConversationRow>('SELECT c.* FROM conversations c WHERE c.id = ?', [
    id,
  ]);
  const row = rows[0];
  return row ? toConversation(row) : null;
}

export async function createConversation(
  db: Db,
  settings: ConversationSettings,
  now = Date.now(),
): Promise<Conversation> {
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO conversations
       (id, title, created_at, updated_at, provider, model, system_prompt, system_prompt_id, system_prompt_vars, tools_mode, cwd, project_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      DEFAULT_TITLE,
      now,
      now,
      settings.provider,
      settings.model,
      settings.systemPrompt,
      settings.systemPromptId,
      varsJson(settings.systemPromptVars),
      settings.toolsMode,
      settings.cwd,
      settings.projectId,
    ],
  );
  return {
    id,
    title: DEFAULT_TITLE,
    pinned: false,
    createdAt: now,
    updatedAt: now,
    ...settings,
  };
}

export async function renameConversation(db: Db, id: string, title: string): Promise<void> {
  await db.execute('UPDATE conversations SET title = ? WHERE id = ?', [title, id]);
}

export async function setPinned(db: Db, id: string, pinned: boolean): Promise<void> {
  await db.execute('UPDATE conversations SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id]);
}

export async function updateSettings(
  db: Db,
  id: string,
  settings: ConversationSettings,
): Promise<void> {
  await db.execute(
    `UPDATE conversations
        SET provider = ?, model = ?, system_prompt = ?, system_prompt_id = ?, system_prompt_vars = ?,
            tools_mode = ?, cwd = ?, project_id = ?
      WHERE id = ?`,
    [
      settings.provider,
      settings.model,
      settings.systemPrompt,
      settings.systemPromptId,
      varsJson(settings.systemPromptVars),
      settings.toolsMode,
      settings.cwd,
      settings.projectId,
      id,
    ],
  );
}

export async function touchConversation(db: Db, id: string, now = Date.now()): Promise<void> {
  await db.execute('UPDATE conversations SET updated_at = ? WHERE id = ?', [now, id]);
}

/** Messages are removed by the ON DELETE CASCADE foreign key. */
export async function deleteConversation(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM conversations WHERE id = ?', [id]);
}

export async function listMessages(db: Db, conversationId: string): Promise<Message[]> {
  const rows = await db.select<MessageRow>(
    // rowid breaks created_at ties so two messages in the same millisecond keep insert order.
    'SELECT * FROM messages WHERE conversation_id = ? ORDER BY created_at, rowid',
    [conversationId],
  );
  return rows.map(toMessage);
}

export async function insertMessage(db: Db, message: Message): Promise<void> {
  await db.execute(
    `INSERT INTO messages
       (id, conversation_id, role, content, created_at, attachments, status, error, model, input_tokens, output_tokens,
        cache_read_tokens, cache_creation_tokens, cost_usd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      message.id,
      message.conversationId,
      message.role,
      message.content,
      message.createdAt,
      message.attachments.length > 0 ? JSON.stringify(message.attachments) : null,
      message.status,
      message.error ? JSON.stringify(message.error) : null,
      message.model,
      message.inputTokens,
      message.outputTokens,
      message.cacheReadTokens,
      message.cacheCreationTokens,
      message.costUsd,
    ],
  );
}

/** Deletes a message and everything after it in the conversation (edit/regenerate rewinds history). */
export async function deleteMessagesFrom(
  db: Db,
  conversationId: string,
  messageId: string,
): Promise<void> {
  await db.execute(
    `DELETE FROM messages
      WHERE conversation_id = ?
        AND rowid >= (SELECT rowid FROM messages WHERE id = ? AND conversation_id = ?)`,
    [conversationId, messageId, conversationId],
  );
}
