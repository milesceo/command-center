import type { Conversation, Message, Project } from '../../lib/types';

export interface ThreadGroup {
  project: Project | null;
  conversations: Conversation[];
}

/** Projects by name with their threads newest first, then threads without a project. */
export function groupThreads(
  conversations: readonly Conversation[],
  projects: readonly Project[],
): ThreadGroup[] {
  const byRecent = (a: Conversation, b: Conversation) => b.updatedAt - a.updatedAt;
  const groups: ThreadGroup[] = [...projects]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((project) => ({
      project,
      conversations: conversations.filter((c) => c.projectId === project.id).sort(byRecent),
    }));
  const known = new Set(projects.map((p) => p.id));
  const loose = conversations
    .filter((c) => c.projectId === null || !known.has(c.projectId))
    .sort(byRecent);
  return loose.length > 0 ? [...groups, { project: null, conversations: loose }] : groups;
}

const SERIES = [
  'var(--series-1)',
  'var(--series-2)',
  'var(--series-3)',
  'var(--series-4)',
] as const;

/** A stable accent per project, so a thread's tab shows which project it belongs to. */
export function projectColor(projectId: string | null): string {
  if (!projectId) return 'var(--fg-subtle)';
  let hash = 0;
  for (const ch of projectId) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return SERIES[hash % SERIES.length] ?? SERIES[0];
}

/** One user prompt with the reply it got (null while unanswered). */
export interface Turn {
  index: number;
  user: Message;
  assistant: Message | null;
}

export function buildTurns(messages: readonly Message[]): Turn[] {
  const turns: Turn[] = [];
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.role !== 'user') continue;
    const next = messages[i + 1];
    turns.push({
      index: turns.length,
      user: message,
      assistant: next?.role === 'assistant' ? next : null,
    });
  }
  return turns;
}

/** First non-empty line, clipped, for one-line summaries. */
export function firstLine(text: string, max = 80): string {
  const line =
    text
      .split('\n')
      .map((l) => l.replace(/^[#>*\-\s`]+/, '').trim())
      .find((l) => l.length > 0) ?? '';
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}
