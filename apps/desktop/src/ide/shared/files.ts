import { findPreviousVersion, type ConversationBlock } from '../../lib/code-blocks';

export interface FileVersion {
  /** 1-based version number within the file. */
  n: number;
  messageId: string;
  code: string;
  /** 1-based fence line inside its message, which orders blocks of one reply. */
  line: number;
}

/** One logical file across a conversation: every distinct version Claude wrote. */
export interface FileEntry {
  key: string;
  /** Display name: the fence's file name, else the language, numbered when repeated. */
  name: string;
  language: string;
  label: string;
  filename: string | null;
  versions: FileVersion[];
}

const baseName = (name: string) => name.split(/[\\/]/).pop()?.toLowerCase() ?? name.toLowerCase();

/**
 * Groups a conversation's code blocks into files with a version history.
 * Same file name wins; unnamed blocks join the most similar earlier block of
 * the same language (the same heuristic the "compare with earlier version"
 * action uses). Unified diffs are not files, and a block identical to the
 * latest version of its file adds no version.
 */
export function deriveFiles(blocks: readonly ConversationBlock[]): FileEntry[] {
  const files: FileEntry[] = [];
  const groupOf = new Map<ConversationBlock, FileEntry>();
  const seen: ConversationBlock[] = [];
  const perLanguage = new Map<string, number>();

  for (const block of blocks) {
    if (block.language === 'diff' || block.code.trim() === '') continue;

    let file: FileEntry | undefined;
    if (block.filename) {
      const name = baseName(block.filename);
      file = files.find((f) => f.filename !== null && baseName(f.filename) === name);
    }
    if (!file) {
      const previous = findPreviousVersion(seen, {
        messageId: block.messageId,
        language: block.language,
        filename: block.filename,
        code: block.code,
      });
      file = previous ? groupOf.get(previous) : undefined;
    }
    if (!file) {
      // Only unnamed blocks are numbered; a named file keeps its own name.
      const count = block.filename ? 0 : (perLanguage.get(block.language) ?? 0) + 1;
      if (!block.filename) perLanguage.set(block.language, count);
      const base = block.filename
        ? (block.filename.split(/[\\/]/).pop() ?? block.filename)
        : block.label || block.language || 'text';
      file = {
        key: `f${files.length + 1}`,
        name: block.filename || count === 1 ? base : `${base} ${count}`,
        language: block.language,
        label: block.label,
        filename: block.filename,
        versions: [],
      };
      files.push(file);
    }

    seen.push(block);
    groupOf.set(block, file);
    const latest = file.versions[file.versions.length - 1];
    if (latest?.code === block.code) continue;
    file.versions.push({
      n: file.versions.length + 1,
      messageId: block.messageId,
      code: block.code,
      line: block.line,
    });
  }
  return files;
}
