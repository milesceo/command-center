import { memo, type CSSProperties } from 'react';
import { cn } from '../../lib/cn';
import type { HighlightedLines, ThemedToken } from '../../lib/highlight';

interface Props {
  code: string;
  /** Latest tokens, possibly for slightly older text (a streaming block); lines that no longer match render plain. */
  tokens: HighlightedLines | null;
  wrap: boolean;
  /** Render only the first N lines (collapsed blocks). */
  maxLines?: number;
}

// Shiki FontStyle bit flags.
const ITALIC = 1;
const BOLD = 2;
const UNDERLINE = 4;

function tokenStyle(token: ThemedToken): CSSProperties | undefined {
  const style: CSSProperties = {};
  if (token.color) style.color = token.color;
  const f = token.fontStyle ?? 0;
  if (f & ITALIC) style.fontStyle = 'italic';
  if (f & BOLD) style.fontWeight = 600;
  if (f & UNDERLINE) style.textDecoration = 'underline';
  return Object.keys(style).length > 0 ? style : undefined;
}

const sameLine = (tokens: ThemedToken[] | undefined, text: string) =>
  tokens !== undefined && tokens.map((t) => t.content).join('') === text;

/** Code with a line-number gutter. The gutter is not selectable, so copying a selection yields only code. */
export const CodeLines = memo(function CodeLines({ code, tokens, wrap, maxLines }: Props) {
  const all = code.split('\n');
  const lines = maxLines === undefined ? all : all.slice(0, maxLines);
  const gutter = `${String(all.length).length}ch`;

  return (
    <pre
      className={cn('selectable code-lines', wrap && 'code-wrap')}
      style={{ ['--gutter' as string]: gutter }}
    >
      <code>
        {lines.map((text, i) => {
          const line = tokens?.[i];
          return (
            <span className="code-line" key={i}>
              <span className="code-ln" aria-hidden="true">
                {i + 1}
              </span>
              <span className="code-lc">
                {sameLine(line, text)
                  ? line?.map((token, k) => (
                      <span key={k} style={tokenStyle(token)}>
                        {token.content}
                      </span>
                    ))
                  : text}
                {'\n'}
              </span>
            </span>
          );
        })}
      </code>
    </pre>
  );
});
