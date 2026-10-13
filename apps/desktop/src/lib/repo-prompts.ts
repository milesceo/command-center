import type { Db } from './db';
import { normalizeTags, type LibraryPrompt } from './prompt-library';
import type { Prompt, PromptKind } from './types';

interface PromptRow {
  id: string;
  kind: PromptKind;
  title: string;
  body: string;
  tags: string;
  created_at: number;
  updated_at: number;
}

function toPrompt(row: PromptRow): Prompt {
  let tags: string[] = [];
  try {
    const parsed: unknown = JSON.parse(row.tags);
    if (Array.isArray(parsed)) tags = parsed.filter((t): t is string => typeof t === 'string');
  } catch {
    // A corrupt tags column should not hide the prompt.
  }
  return {
    id: row.id,
    kind: row.kind,
    title: row.title,
    body: row.body,
    tags,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export interface PromptInput {
  kind: PromptKind;
  title: string;
  body: string;
  tags: string[];
}

export async function listPrompts(db: Db): Promise<Prompt[]> {
  const rows = await db.select<PromptRow>(
    'SELECT * FROM prompts ORDER BY title COLLATE NOCASE, created_at',
  );
  return rows.map(toPrompt);
}

export async function getPrompt(db: Db, id: string): Promise<Prompt | null> {
  const rows = await db.select<PromptRow>('SELECT * FROM prompts WHERE id = ?', [id]);
  const row = rows[0];
  return row ? toPrompt(row) : null;
}

export async function createPrompt(db: Db, input: PromptInput, now = Date.now()): Promise<Prompt> {
  const prompt: Prompt = {
    id: crypto.randomUUID(),
    kind: input.kind,
    title: input.title.trim(),
    body: input.body,
    tags: normalizeTags(input.tags),
    createdAt: now,
    updatedAt: now,
  };
  await insertPrompt(db, prompt);
  return prompt;
}

async function insertPrompt(db: Db, p: Prompt): Promise<void> {
  await db.execute(
    'INSERT INTO prompts (id, kind, title, body, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [p.id, p.kind, p.title, p.body, JSON.stringify(p.tags), p.createdAt, p.updatedAt],
  );
}

export async function updatePrompt(
  db: Db,
  id: string,
  input: PromptInput,
  now = Date.now(),
): Promise<void> {
  await db.execute(
    'UPDATE prompts SET kind = ?, title = ?, body = ?, tags = ?, updated_at = ? WHERE id = ?',
    [
      input.kind,
      input.title.trim(),
      input.body,
      JSON.stringify(normalizeTags(input.tags)),
      now,
      id,
    ],
  );
}

/** Conversations and projects that used this prompt keep working: their link is cleared by the foreign key. */
export async function deletePrompt(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM prompts WHERE id = ?', [id]);
}

export interface ImportResult {
  added: number;
  updated: number;
  skipped: number;
}

/**
 * Merges imported prompts. Same id: overwritten when the import is newer (else
 * skipped). Different id but identical kind/title/body: skipped as a duplicate.
 * Everything else is added with its own id.
 */
export async function importPrompts(
  db: Db,
  incoming: LibraryPrompt[],
  now = Date.now(),
): Promise<ImportResult> {
  const existing = await listPrompts(db);
  const byId = new Map(existing.map((p) => [p.id, p]));
  const fingerprints = new Set(existing.map((p) => `${p.kind}\u0000${p.title}\u0000${p.body}`));
  const result: ImportResult = { added: 0, updated: 0, skipped: 0 };

  for (const item of incoming) {
    const tags = normalizeTags(item.tags);
    const current = byId.get(item.id);
    if (current) {
      const newer = (item.updatedAt ?? 0) > current.updatedAt;
      if (!newer) {
        result.skipped++;
        continue;
      }
      await updatePrompt(
        db,
        item.id,
        { kind: item.kind, title: item.title, body: item.body, tags },
        item.updatedAt,
      );
      result.updated++;
      continue;
    }
    const fingerprint = `${item.kind}\u0000${item.title}\u0000${item.body}`;
    if (fingerprints.has(fingerprint)) {
      result.skipped++;
      continue;
    }
    fingerprints.add(fingerprint);
    await insertPrompt(db, {
      id: item.id,
      kind: item.kind,
      title: item.title,
      body: item.body,
      tags,
      createdAt: item.createdAt ?? now,
      updatedAt: item.updatedAt ?? now,
    });
    result.added++;
  }
  return result;
}

/** Case-insensitive match on title, tags or body, optionally restricted to one kind. Pure, so the slash menu can reuse it. */
export function searchPrompts(prompts: Prompt[], query: string, kind?: PromptKind): Prompt[] {
  const q = query.trim().toLowerCase();
  const pool = kind ? prompts.filter((p) => p.kind === kind) : prompts;
  if (!q) return pool;
  const score = (p: Prompt): number => {
    const title = p.title.toLowerCase();
    if (title.startsWith(q)) return 0;
    if (title.includes(q)) return 1;
    if (p.tags.some((t) => t.toLowerCase().includes(q))) return 2;
    if (p.body.toLowerCase().includes(q)) return 3;
    return -1;
  };
  return pool
    .map((p) => ({ p, s: score(p) }))
    .filter(({ s }) => s >= 0)
    .sort((a, b) => a.s - b.s || a.p.title.localeCompare(b.p.title))
    .map(({ p }) => p);
}
