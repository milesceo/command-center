import { lazy, memo, Suspense, useMemo, type ComponentProps } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { Element } from 'hast';
import { toString as nodeToString } from 'hast-util-to-string';
import { looksLikeDiff, parseFence } from '../../lib/fence';
import { openExternal } from '../../lib/external';
import { splitBlocks } from '../../lib/markdown-blocks';
import { CodeBlock } from '../code/CodeBlock';
import { MarkdownContext, useMarkdownContext } from './markdown-context';

// The diff renderer pulls in the diff library, so it is fetched only when a reply contains a diff.
const DiffBlock = lazy(() => import('../code/DiffBlock'));

type PreProps = ComponentProps<'pre'> & ExtraProps;

/** A fenced block: highlighted code, or a rendered diff when it is a unified diff. */
function FencedCode({ node, blockIndex }: PreProps & { blockIndex: number }) {
  const { messageId } = useMarkdownContext();
  const codeEl = node?.children.find(
    (c): c is Element => c.type === 'element' && c.tagName === 'code',
  );
  if (!codeEl) return null;

  const classes = Array.isArray(codeEl.properties.className)
    ? codeEl.properties.className.map(String)
    : [];
  const languageToken = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length);
  const meta = (codeEl.data as { meta?: string } | undefined)?.meta;
  const info = parseFence(languageToken, meta);
  const code = nodeToString(codeEl).replace(/\n$/, '');
  const blockKey = `${messageId}:${blockIndex}:${node?.position?.start.line ?? 0}`;

  if (looksLikeDiff(info, code)) {
    return (
      <Suspense
        fallback={
          <CodeBlock
            code={code}
            info={{ ...info, language: 'diff', label: 'diff' }}
            blockKey={blockKey}
          />
        }
      >
        <DiffBlock code={code} filename={info.filename} blockKey={blockKey} />
      </Suspense>
    );
  }
  return <CodeBlock code={code} info={info} blockKey={blockKey} />;
}

const link: Components['a'] = ({ href, children }) => (
  <a
    href={href}
    onClick={(e) => {
      e.preventDefault();
      if (href) void openExternal(href);
    }}
  >
    {children}
  </a>
);

const remarkPlugins = [remarkGfm];

const Block = memo(function Block({ text, blockIndex }: { text: string; blockIndex: number }) {
  // The index is part of each block's code-block identity, so the component map is per block.
  const components = useMemo<Components>(
    () => ({
      a: link,
      pre: (props: PreProps) => <FencedCode {...props} blockIndex={blockIndex} />,
    }),
    [blockIndex],
  );
  return (
    <ReactMarkdown remarkPlugins={remarkPlugins} components={components}>
      {text}
    </ReactMarkdown>
  );
});

interface Props {
  text: string;
  /** Identifies the message so code blocks can be tracked (live previews, earlier-version diffs). */
  messageId?: string;
  streaming?: boolean;
}

/**
 * Renders markdown one top-level block at a time. Finished blocks receive an
 * identical string on every update, so React.memo skips them and a streaming
 * reply only re-parses its last block. Raw HTML is not rendered (react-markdown default).
 */
export const Markdown = memo(function Markdown({
  text,
  messageId = 'detached',
  streaming = false,
}: Props) {
  const context = useMemo(() => ({ messageId, streaming }), [messageId, streaming]);
  return (
    <MarkdownContext.Provider value={context}>
      <div className="md">
        {splitBlocks(text).map((block, i) => (
          <Block key={i} text={block} blockIndex={i} />
        ))}
      </div>
    </MarkdownContext.Provider>
  );
});
