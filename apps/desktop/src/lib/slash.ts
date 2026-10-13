/** Slash-command helpers for the composer: `/` at the start of a line opens the prompt picker. */

export interface SlashQuery {
  /** Index of the `/` in the text. */
  start: number;
  /** Text typed after the slash, up to the caret. */
  query: string;
}

/**
 * The slash token the caret is in, if any. The slash must start a line and the token
 * must not contain whitespace yet (a space ends the command, so "/ not a command" and
 * paths like "src/a" mid-line never open the picker).
 */
export function findSlashQuery(text: string, caret: number): SlashQuery | null {
  const lineStart = text.lastIndexOf('\n', caret - 1) + 1;
  const token = text.slice(lineStart, caret);
  if (!token.startsWith('/') || /\s/.test(token)) return null;
  return { start: lineStart, query: token.slice(1) };
}

/** Replaces `text[start, caret)` with `insertion` and says where the caret should go. */
export function applyInsertion(
  text: string,
  start: number,
  caret: number,
  insertion: string,
): { text: string; caret: number } {
  return {
    text: text.slice(0, start) + insertion + text.slice(caret),
    caret: start + insertion.length,
  };
}
