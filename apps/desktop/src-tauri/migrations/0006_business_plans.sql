-- Business plans the owner reads in the app: standalone HTML documents (for example a plan made
-- as a Claude artifact), stored only in this local database. They are shown in the sandboxed
-- preview frame, never inside the app's own page.
CREATE TABLE business_plans (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  -- The whole HTML document.
  html TEXT NOT NULL,
  -- Where it came from (a file name or a link), shown as plain text only.
  source TEXT,
  -- Reading order in the list: lowest first.
  position INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
