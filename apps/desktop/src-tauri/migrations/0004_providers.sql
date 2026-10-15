-- Which AI provider a conversation uses. Existing chats keep using Claude.
ALTER TABLE conversations ADD COLUMN provider TEXT NOT NULL DEFAULT 'claude';
