-- Chat features: pinning, per-conversation settings, and richer messages.
-- Messages are stored as plain text; `attachments` and `error` hold JSON.

ALTER TABLE conversations ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
-- NULL model means "let the runtime pick its default".
ALTER TABLE conversations ADD COLUMN model TEXT;
ALTER TABLE conversations ADD COLUMN system_prompt TEXT;
-- Plain chat is the default; read-only file tools are an explicit opt-in.
ALTER TABLE conversations ADD COLUMN tools_mode TEXT NOT NULL DEFAULT 'off'
  CHECK (tools_mode IN ('off', 'readonly'));
ALTER TABLE conversations ADD COLUMN cwd TEXT;

-- JSON array of { name, text }.
ALTER TABLE messages ADD COLUMN attachments TEXT;
-- 'stopped' = the user pressed Stop; 'error' = the reply was cut short by a failure.
ALTER TABLE messages ADD COLUMN status TEXT NOT NULL DEFAULT 'complete'
  CHECK (status IN ('complete', 'stopped', 'error'));
-- JSON BridgeError, set when status = 'error'.
ALTER TABLE messages ADD COLUMN error TEXT;
ALTER TABLE messages ADD COLUMN model TEXT;
ALTER TABLE messages ADD COLUMN input_tokens INTEGER;
ALTER TABLE messages ADD COLUMN output_tokens INTEGER;

CREATE INDEX idx_conversations_pinned_updated ON conversations(pinned DESC, updated_at DESC);
