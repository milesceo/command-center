import { parseFence } from './fence';

/** One fenced block found in a message's markdown. */
export interface ExtractedBlock {
  label: string;
  language: string;
  filename: string | null;
  code: string;
  /** 1-based line of the opening fence within the message. */
  line: number;
}

/** A fenced block located in the conversation. */
export interface ConversationBlock extends ExtractedBlock {
  messageId: string;
}

const OPEN = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\s`]*)[ \t]*(.*)$/;

/**
 * Finds fenced code blocks the way the renderer does. An unterminated fence
 * (a reply still streaming) runs to the end of the text.
 */
export function extractCodeBlocks(markdown: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];
  const lines = markdown.split('\n');
  for (let i = 0; i < lines.length; i++) {
    const open = OPEN.exec(lines[i] as string);
    if (!open) continue;
    const fence = open[1] as string;
    const body: string[] = [];
    let j = i + 1;
    for (; j < lines.length; j++) {
      const line = lines[j] as string;
      const close = /^ {0,3}(`{3,}|~{3,})[ \t]*$/.exec(line)?.[1];
      if (close && close[0] === fence[0] && close.length >= fence.length) break;
      body.push(line);
    }
    const info = parseFence(open[2], open[3]);
    blocks.push({ ...info, code: body.join('\n'), line: i + 1 });
    i = j;
  }
  return blocks;
}

const significantLines = (code: string) =>
  new Set(
    code
      .split('\n')
      .map((l) => l.trim())
      .filter((l) => l.length > 0),
  );

/** Jaccard similarity of the sets of non-blank trimmed lines (0..1). */
export function similarity(a: string, b: string): number {
  const sa = significantLines(a);
  const sb = significantLines(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  let shared = 0;
  for (const line of sa) if (sb.has(line)) shared++;
  return shared / (sa.size + sb.size - shared);
}

const baseName = (name: string) => name.split(/[\\/]/).pop()?.toLowerCase() ?? name.toLowerCase();

export interface BlockQuery {
  /** Message holding the block; blocks from that message onward are ignored. */
  messageId: string;
  language: string;
  filename: string | null;
  code: string;
}

/** A block must share at least this fraction of its lines to count as "an earlier version". */
const MIN_SIMILARITY = 0.4;

/**
 * Finds the earlier version of a block: the latest block with the same file
 * name, otherwise the most similar earlier block in the same language. Blocks
 * identical to the query are skipped because there would be nothing to diff.
 */
export function findPreviousVersion(
  blocks: ConversationBlock[],
  query: BlockQuery,
): ConversationBlock | null {
  const own = blocks.findIndex((b) => b.messageId === query.messageId);
  const earlier = (own === -1 ? blocks : blocks.slice(0, own)).filter(
    (b) => b.language !== 'diff' && b.code !== query.code,
  );

  if (query.filename) {
    const name = baseName(query.filename);
    const byName = earlier.filter((b) => b.filename && baseName(b.filename) === name);
    const latest = byName[byName.length - 1];
    if (latest) return latest;
  }
  if (!query.language) return null;

  let best: ConversationBlock | null = null;
  let bestScore = MIN_SIMILARITY;
  for (const block of earlier) {
    if (block.language !== query.language) continue;
    const score = similarity(block.code, query.code);
    // `>=` so that among equally similar blocks the most recent wins.
    if (score >= bestScore) {
      best = block;
      bestScore = score;
    }
  }
  return best;
}
