import { useEffect, useId, useState } from 'react';
import { highlightCode, type HighlightedLines } from '../../lib/highlight';

/** Re-highlighting a block that is still streaming waits this long after the last change. */
const REHIGHLIGHT_DEBOUNCE_MS = 90;

/**
 * Tokens for `code`, loading the grammar on first use. The first result is
 * immediate; later changes (a reply still streaming) are debounced so a fast
 * stream is tokenized a few times a second instead of on every chunk. Until new
 * tokens arrive the previous ones stay, and CodeLines drops any line that no
 * longer matches, so there is no flash of unstyled code.
 */
export function useHighlighted(code: string, language: string): HighlightedLines | null {
  const channel = useId();
  const [tokens, setTokens] = useState<HighlightedLines | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const run = () =>
      void highlightCode(code, language, channel).then((result) => {
        if (cancelled) return;
        // null also means "superseded by a newer request", so keep showing the last good tokens.
        setTokens((previous) => result ?? previous);
        setReady(true);
      });
    if (!ready) {
      run();
      return () => {
        cancelled = true;
      };
    }
    const timer = setTimeout(run, REHIGHLIGHT_DEBOUNCE_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
    // `ready` only selects the debounce; it must not retrigger the effect on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code, language]);

  return tokens;
}
