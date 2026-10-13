import type { Db } from './db';
import type { Project } from './types';

interface ProjectRow {
  id: string;
  name: string;
  default_system_prompt_id: string | null;
  default_system_prompt_vars: string | null;
  created_at: number;
  updated_at: number;
}

function toProject(row: ProjectRow): Project {
  let vars: Record<string, string> = {};
  try {
    const parsed: unknown = row.default_system_prompt_vars
      ? JSON.parse(row.default_system_prompt_vars)
      : {};
    if (typeof parsed === 'object' && parsed !== null) vars = parsed as Record<string, string>;
  } catch {
    // Ignore corrupt variable values; the prompt then renders with blanks.
  }
  return {
    id: row.id,
    name: row.name,
    defaultSystemPromptId: row.default_system_prompt_id,
    defaultSystemPromptVars: vars,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listProjects(db: Db): Promise<Project[]> {
  const rows = await db.select<ProjectRow>(
    'SELECT * FROM projects ORDER BY name COLLATE NOCASE, created_at',
  );
  return rows.map(toProject);
}

export async function getProject(db: Db, id: string): Promise<Project | null> {
  const rows = await db.select<ProjectRow>('SELECT * FROM projects WHERE id = ?', [id]);
  const row = rows[0];
  return row ? toProject(row) : null;
}

export async function createProject(db: Db, name: string, now = Date.now()): Promise<Project> {
  const project: Project = {
    id: crypto.randomUUID(),
    name: name.trim(),
    defaultSystemPromptId: null,
    defaultSystemPromptVars: {},
    createdAt: now,
    updatedAt: now,
  };
  await db.execute('INSERT INTO projects (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)', [
    project.id,
    project.name,
    now,
    now,
  ]);
  return project;
}

export async function renameProject(
  db: Db,
  id: string,
  name: string,
  now = Date.now(),
): Promise<void> {
  await db.execute('UPDATE projects SET name = ?, updated_at = ? WHERE id = ?', [
    name.trim(),
    now,
    id,
  ]);
}

export async function setProjectSystemPrompt(
  db: Db,
  id: string,
  promptId: string | null,
  vars: Record<string, string>,
  now = Date.now(),
): Promise<void> {
  await db.execute(
    'UPDATE projects SET default_system_prompt_id = ?, default_system_prompt_vars = ?, updated_at = ? WHERE id = ?',
    [promptId, promptId && Object.keys(vars).length > 0 ? JSON.stringify(vars) : null, now, id],
  );
}

/** Conversations in the project are kept; they just become ungrouped (foreign key SET NULL). */
export async function deleteProject(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM projects WHERE id = ?', [id]);
}
