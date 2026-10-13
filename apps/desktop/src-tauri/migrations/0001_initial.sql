-- Conversations and messages only. Timestamps are unix epoch milliseconds
-- (set by the app) so ordering is stable and timezone-free.
CREATE TABLE conversations (
  id          TEXT PRIMARY KEY NOT NULL,
  title       TEXT NOT NULL DEFAULT 'New chat',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);

CREATE TABLE messages (
  id               TEXT PRIMARY KEY NOT NULL,
  conversation_id  TEXT NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
  role             TEXT NOT NULL CHECK (role IN ('user', 'assistant', 'system')),
  content          TEXT NOT NULL,
  created_at       INTEGER NOT NULL
);

CREATE INDEX idx_messages_conversation ON messages(conversation_id, created_at);
CREATE INDEX idx_conversations_updated ON conversations(updated_at DESC);
