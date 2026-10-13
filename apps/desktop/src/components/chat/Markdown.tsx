import { memo, isValidElement, type ComponentProps, type ReactNode } from 'react';
import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { openExternal } from '../../lib/external';
import { rehypeLowlight } from '../../lib/rehype-lowlight';
import { splitBlocks } from '../../lib/markdown-blocks';
import { CopyButton } from '../ui/copy-button';

/** Plain text of a React subtree (the highlighter wraps tokens in spans; copy must not). */
export function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return nodeText(node.props.children);
  return '';
}

function CodeBlock({ children }: ComponentProps<'pre'>) {
  const code = isValidElement<{ className?: string; children?: ReactNode }>(children)
    ? children
    : null;
  const language = /language-([\w-]+)/.exec(code?.props.className ?? '')?.[1];
  return (
    <div className="code-block my-3 overflow-hidden rounded-panel border border-border bg-surface">
      <div className="flex h-8 items-center justify-between border-b border-border pr-1 pl-3 text-xs text-fg-subtle">
        <span className="font-mono">{language ?? 'text'}</span>
        <CopyButton label="Copy code" text={() => nodeText(children).replace(/\n$/, '')} />
      </div>
      <pre className="selectable">{children}</pre>
    </div>
  );
}

const components: Components = {
  pre: CodeBlock,
  a: ({ href, children }) => (
    <a
      href={href}
      onClick={(e) => {
        e.preventDefault();
        if (href) void openExternal(href);
      }}
    >
      {children}
    </a>
  ),
};

const remarkPlugins = [remarkGfm];
const rehypePlugins = [rehypeLowlight];

const Block = memo(function Block({ text }: { text: string }) {
  return (
    <ReactMarkdown
      remarkPlugins={remarkPlugins}
      rehypePlugins={rehypePlugins}
      components={components}
    >
      {text}
    </ReactMarkdown>
  );
});

/**
 * Renders markdown one top-level block at a time. Finished blocks receive an
 * identical string on every update, so React.memo skips them and a streaming
 * reply only re-parses its last block. Raw HTML is not rendered (react-markdown default).
 */
export const Markdown = memo(function Markdown({ text }: { text: string }) {
  return (
    <div className="md">
      {splitBlocks(text).map((block, i) => (
        <Block key={i} text={block} />
      ))}
    </div>
  );
});
