import type { Element, Root } from 'hast';
import { toString } from 'hast-util-to-string';
import { common, createLowlight } from 'lowlight';
import { visit } from 'unist-util-visit';

/**
 * One shared highlighter. `rehype-highlight` builds a fresh one (registering
 * ~40 grammars) every time react-markdown rebuilds its processor, which is on
 * every render, and that alone cost hundreds of ms while a reply streamed.
 */
const lowlight = createLowlight(common);

/** Highlights fenced code blocks whose language is known; unknown languages stay plain. */
export function rehypeLowlight() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element, _index, parent) => {
      if (node.tagName !== 'code' || (parent as Element | undefined)?.tagName !== 'pre') return;
      const classes = Array.isArray(node.properties.className)
        ? node.properties.className.map(String)
        : [];
      const language = classes.find((c) => c.startsWith('language-'))?.slice('language-'.length);
      if (!language || !lowlight.registered(language)) return;
      node.children = lowlight.highlight(language, toString(node)).children as Element['children'];
      node.properties.className = [...classes, 'hljs'];
    });
  };
}

/**
 * Grammars compile lazily on first use (~100 ms for TypeScript), which would land
 * mid-stream as a visible hitch. Do it once while the app is idle at startup.
 */
export function warmUpHighlighter(): void {
  const run = () => {
    for (const language of ['typescript', 'javascript', 'json', 'bash', 'python', 'rust']) {
      lowlight.highlight(language, '');
    }
  };
  if (typeof requestIdleCallback === 'function') requestIdleCallback(run);
  else setTimeout(run, 500);
}
