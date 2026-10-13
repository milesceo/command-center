import type { Attachment, BridgeError } from '@programish/protocol';
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
  system_prompt: string | null;
  tools_mode: 'off' | 'readonly';
  cwd: string | null;
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
  created_at: number;
}

function toConversation(row: ConversationRow): Conversation {
  const conversation: Conversation = {
    id: row.id,
    title: row.title,
    pinned: row.pinned === 1,
    model: row.model,
    systemPrompt: row.system_prompt,
    toolsMode: row.tools_mode,
    cwd: row.cwd,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (row.title_match !== undefined) conversation.titleMatch = row.title_match === 1;
  return conversation;
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
    `INSERT INTO conversations (id, title, created_at, updated_at, model, system_prompt, tools_mode, cwd)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      DEFAULT_TITLE,
      now,
      now,
      settings.model,
      settings.systemPrompt,
      settings.toolsMode,
      settings.cwd,
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
    'UPDATE conversations SET model = ?, system_prompt = ?, tools_mode = ?, cwd = ? WHERE id = ?',
    [settings.model, settings.systemPrompt, settings.toolsMode, settings.cwd, id],
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
       (id, conversation_id, role, content, created_at, attachments, status, error, model, input_tokens, output_tokens)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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
