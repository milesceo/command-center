/**
 * Splits markdown into top-level blocks at blank lines that are outside fenced
 * code. While a reply streams only the last block changes, so rendering each
 * block as its own memoized component keeps per-token work constant instead of
 * re-parsing the whole message.
 */
export function splitBlocks(markdown: string): string[] {
  const blocks: string[] = [];
  let current: string[] = [];
  let fence: string | null = null;

  const flush = () => {
    if (current.length > 0) blocks.push(current.join('\n'));
    current = [];
  };

  for (const line of markdown.split('\n')) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line)?.[1];
    if (marker) {
      if (fence === null) fence = marker;
      else if (marker[0] === fence[0] && marker.length >= fence.length) fence = null;
    }
    if (fence === null && line.trim() === '' && !marker) {
      flush();
    } else {
      current.push(line);
    }
  }
  flush();
  return blocks;
}
