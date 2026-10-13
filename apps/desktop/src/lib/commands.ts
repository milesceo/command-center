/** The command palette's data model and ranking. Pure, so it is tested without a DOM. */

export interface Command {
  id: string;
  title: string;
  /** Section heading in the list ("Actions", "Conversations", ...). */
  group: string;
  /** Extra words that should find the command without being shown. */
  keywords?: string;
  /** Display-only hint, e.g. `Mod+Shift+P`. */
  shortcut?: string;
  run: () => void;
}

/**
 * Scores how well `query` matches `text`: a prefix beats a word start beats a contiguous
 * substring beats a scattered subsequence. Returns null for no match. Higher is better.
 */
export function matchScore(query: string, text: string): number | null {
  const q = query.trim().toLowerCase();
  if (q === '') return 0;
  const t = text.toLowerCase();
  if (t.startsWith(q)) return 1000 - t.length;
  const wordStart = t.search(
    new RegExp(`(?:^|[\\s:/_-])${q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`),
  );
  if (wordStart >= 0) return 800 - wordStart;
  const at = t.indexOf(q);
  if (at >= 0) return 600 - at;
  // Subsequence: every character in order, rewarding runs and early matches.
  let from = 0;
  let score = 300;
  let streak = 0;
  for (const ch of q) {
    const i = t.indexOf(ch, from);
    if (i < 0) return null;
    streak = i === from ? streak + 1 : 0;
    score += streak * 2 - (i - from);
    from = i + 1;
  }
  return Math.max(1, score - t.length / 10);
}

/** Commands matching `query`, best first. With no query, the original order is kept. */
export function filterCommands(commands: readonly Command[], query: string, limit = 60): Command[] {
  if (query.trim() === '') return commands.slice(0, limit);
  const scored: { command: Command; score: number; order: number }[] = [];
  commands.forEach((command, order) => {
    const direct = matchScore(query, command.title);
    const viaGroup = matchScore(
      query,
      `${command.group} ${command.title} ${command.keywords ?? ''}`,
    );
    const best = Math.max(direct ?? -1, viaGroup === null ? -1 : viaGroup - 50);
    if (best >= 0) scored.push({ command, score: best, order });
  });
  return scored
    .sort((a, b) => b.score - a.score || a.order - b.order)
    .slice(0, limit)
    .map((s) => s.command);
}
