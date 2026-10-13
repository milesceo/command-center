-- Usage tracking, the prompt library and projects.

-- ---------------------------------------------------------------- prompts
-- `kind` 'prompt' is inserted into the composer; 'system' is attached to a conversation or project.
-- `tags` is a JSON array of strings; `{{name}}` placeholders in `body` are variables.
CREATE TABLE prompts (
  id          TEXT PRIMARY KEY NOT NULL,
  kind        TEXT NOT NULL CHECK (kind IN ('prompt', 'system')),
  title       TEXT NOT NULL,
  body        TEXT NOT NULL,
  tags        TEXT NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX idx_prompts_kind_title ON prompts(kind, title COLLATE NOCASE);

-- --------------------------------------------------------------- projects
-- A simple grouping of conversations with an optional default system prompt.
CREATE TABLE projects (
  id                          TEXT PRIMARY KEY NOT NULL,
  name                        TEXT NOT NULL,
  default_system_prompt_id    TEXT REFERENCES prompts(id) ON DELETE SET NULL,
  -- JSON object of values for the prompt's {{variables}}.
  default_system_prompt_vars  TEXT,
  created_at                  INTEGER NOT NULL,
  updated_at                  INTEGER NOT NULL
);

-- Deleting a project or prompt must never delete conversations: the links just clear.
ALTER TABLE conversations ADD COLUMN project_id TEXT REFERENCES projects(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN system_prompt_id TEXT REFERENCES prompts(id) ON DELETE SET NULL;
ALTER TABLE conversations ADD COLUMN system_prompt_vars TEXT;
CREATE INDEX idx_conversations_project ON conversations(project_id);

-- ------------------------------------------------------------------ usage
-- Per-message detail, for display next to a reply.
ALTER TABLE messages ADD COLUMN cache_read_tokens INTEGER;
ALTER TABLE messages ADD COLUMN cache_creation_tokens INTEGER;
-- The SDK's API-equivalent price for the reply (informational on a subscription), null when not reported.
ALTER TABLE messages ADD COLUMN cost_usd REAL;

-- The usage ledger: one row per model per finished reply. Deliberately has no foreign
-- keys: tokens were consumed even if the message is later regenerated or the
-- conversation deleted, and the Usage view must keep counting them.
CREATE TABLE usage_log (
  id                    TEXT PRIMARY KEY NOT NULL,
  created_at            INTEGER NOT NULL,
  conversation_id       TEXT,
  message_id            TEXT,
  model                 TEXT NOT NULL,
  input_tokens          INTEGER NOT NULL,
  output_tokens         INTEGER NOT NULL,
  cache_read_tokens     INTEGER NOT NULL,
  cache_creation_tokens INTEGER NOT NULL,
  cost_usd              REAL
);
CREATE INDEX idx_usage_log_created ON usage_log(created_at);
CREATE INDEX idx_usage_log_conversation ON usage_log(conversation_id);

-- Latest reading of each plan usage window (5-hour, weekly, ...), as reported by the SDK.
CREATE TABLE usage_windows (
  key          TEXT PRIMARY KEY NOT NULL,
  label        TEXT NOT NULL,
  utilization  REAL,
  resets_at    INTEGER,
  observed_at  INTEGER NOT NULL,
  source       TEXT NOT NULL CHECK (source IN ('chat', 'report'))
);
