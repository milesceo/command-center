import type { Db } from './db';

/** A business plan: a standalone HTML document the owner reads in the app. */
export interface BusinessPlan {
  id: string;
  title: string;
  html: string;
  /** Where it came from (a file name or link), shown as text only. */
  source: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
}

/** A plan without its document, for the list. */
export type PlanSummary = Omit<BusinessPlan, 'html'>;

interface Row {
  id: string;
  title: string;
  html: string;
  source: string | null;
  position: number;
  created_at: number;
  updated_at: number;
}

/** Large enough for a rich single-page plan with inline images, small enough to keep SQLite quick. */
export const MAX_PLAN_BYTES = 5_000_000;
export const MAX_TITLE = 120;

export class PlanError extends Error {}

/** A numeric character reference's character, or the reference itself when it is out of range. */
const codePoint = (n: number, raw: string): string =>
  n > 0 && n <= 0x10ffff ? String.fromCodePoint(n) : raw;

/** The document's own `<title>`, entity-decoded and trimmed, or null. */
export function titleFromHtml(html: string): string | null {
  // DOMParser builds the document without running its scripts, and ignores an SVG's <title>.
  if (typeof DOMParser !== 'undefined') {
    const title = new DOMParser().parseFromString(html, 'text/html').title.replace(/\s+/g, ' ');
    return title.trim() ? title.trim().slice(0, MAX_TITLE) : null;
  }
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!m?.[1]) return null;
  const text = m[1]
    .replace(/&#x([0-9a-f]{1,6});/gi, (m, h: string) => codePoint(parseInt(h, 16), m))
    .replace(/&#(\d{1,7});/g, (m, d: string) => codePoint(Number(d), m))
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, MAX_TITLE) : null;
}

/** A title from a file name: `short-let_launch-plan.html` → `short let launch plan`. */
export const titleFromFileName = (name: string): string =>
  name
    .replace(/\.[^.]+$/, '')
    .replace(/[-_]+/g, ' ')
    .trim()
    .slice(0, MAX_TITLE) || 'Untitled plan';

function check(title: string, html: string): string {
  const clean = title.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > MAX_TITLE) {
    throw new PlanError(`Give the plan a name of 1 to ${MAX_TITLE} characters.`);
  }
  if (html.trim() === '') throw new PlanError('That file is empty.');
  if (new TextEncoder().encode(html).length > MAX_PLAN_BYTES) {
    throw new PlanError('That plan is larger than 5 MB.');
  }
  return clean;
}

const summary = (r: Omit<Row, 'html'>): PlanSummary => ({
  id: r.id,
  title: r.title,
  source: r.source,
  position: r.position,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

/** Every plan in reading order, without the documents. */
export async function listPlans(db: Db): Promise<PlanSummary[]> {
  const rows = await db.select<Omit<Row, 'html'>>(
    'SELECT id, title, source, position, created_at, updated_at FROM business_plans ORDER BY position, created_at',
  );
  return rows.map(summary);
}

export async function getPlan(db: Db, id: string): Promise<BusinessPlan | null> {
  const rows = await db.select<Row>('SELECT * FROM business_plans WHERE id = ?', [id]);
  const r = rows[0];
  return r ? { ...summary(r), html: r.html } : null;
}

/** Adds a plan at the end of the list. */
export async function createPlan(
  db: Db,
  input: { title: string; html: string; source: string | null },
  now = Date.now(),
): Promise<PlanSummary> {
  const title = check(input.title, input.html);
  const last = await db.select<{ p: number | null }>(
    'SELECT MAX(position) AS p FROM business_plans',
  );
  const position = (last[0]?.p ?? -1) + 1;
  const id = crypto.randomUUID();
  await db.execute(
    `INSERT INTO business_plans (id, title, html, source, position, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [id, title, input.html, input.source, position, now, now],
  );
  return { id, title, source: input.source, position, createdAt: now, updatedAt: now };
}

export async function renamePlan(db: Db, id: string, title: string, now = Date.now()) {
  const clean = check(title, 'x');
  await db.execute('UPDATE business_plans SET title = ?, updated_at = ? WHERE id = ?', [
    clean,
    now,
    id,
  ]);
}

/** Moves a plan to the top of the list. */
export async function movePlanFirst(db: Db, id: string): Promise<void> {
  const first = await db.select<{ p: number | null }>(
    'SELECT MIN(position) AS p FROM business_plans',
  );
  await db.execute('UPDATE business_plans SET position = ? WHERE id = ?', [
    (first[0]?.p ?? 0) - 1,
    id,
  ]);
}

export async function deletePlan(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM business_plans WHERE id = ?', [id]);
}
