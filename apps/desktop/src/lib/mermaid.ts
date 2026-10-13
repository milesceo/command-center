import type Mermaid from 'mermaid';

/** Mermaid is large, so it is fetched only when a diagram is actually previewed. */

let counter = 0;
let configuredFor: 'dark' | 'light' | null = null;

type MermaidApi = typeof Mermaid;

async function load(theme: 'dark' | 'light'): Promise<MermaidApi> {
  const { default: mermaid } = await import('mermaid');
  if (configuredFor !== theme) {
    mermaid.initialize({
      startOnLoad: false,
      // 'strict' sanitizes the diagram text; the result is still shown inside the sandboxed iframe.
      securityLevel: 'strict',
      theme: theme === 'dark' ? 'dark' : 'default',
      fontFamily: 'system-ui, sans-serif',
    });
    configuredFor = theme;
  }
  return mermaid;
}

/** Renders diagram source to an SVG string. Rejects with Mermaid's own message on a syntax error. */
export async function renderMermaid(source: string, theme: 'dark' | 'light'): Promise<string> {
  const mermaid = await load(theme);
  const { svg } = await mermaid.render(`mermaid-${++counter}`, source);
  return svg;
}
