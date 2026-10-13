/** Helpers for the info string of a fenced code block (the text after the opening ```). */

export interface FenceInfo {
  /** Language as the model wrote it, lowercased ('' when absent). */
  label: string;
  /** Canonical language id used for highlighting ('' when unknown or plain). */
  language: string;
  /** File name when the fence provides one. */
  filename: string | null;
}

const ALIASES: Record<string, string> = {
  ts: 'typescript',
  js: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  py: 'python',
  python3: 'python',
  rs: 'rust',
  sh: 'bash',
  shell: 'bash',
  zsh: 'bash',
  console: 'bash',
  shellscript: 'bash',
  yml: 'yaml',
  md: 'markdown',
  cs: 'csharp',
  'c++': 'cpp',
  golang: 'go',
  kt: 'kotlin',
  rb: 'ruby',
  ps1: 'powershell',
  pwsh: 'powershell',
  docker: 'dockerfile',
  patch: 'diff',
  htm: 'html',
  jsonl: 'json',
  gql: 'graphql',
  tex: 'latex',
  text: '',
  txt: '',
  plain: '',
  plaintext: '',
};

export function canonicalLanguage(label: string): string {
  const key = label.trim().toLowerCase();
  return key in ALIASES ? (ALIASES[key] as string) : key;
}

const FILENAME_ATTR = /(?:title|filename|file|name)\s*=\s*(?:"([^"]*)"|'([^']*)'|(\S+))/i;
/** A bare word that looks like a path: has an extension, no scheme. */
const BARE_PATH = /^[\w./\\@-]+\.[A-Za-z0-9]{1,8}$/;

/**
 * Reads the language and optional file name from a fence. Supported spellings:
 * ```ts title="a.ts"```, ```ts filename=a.ts```, ```ts:src/a.ts```, ```ts src/a.ts```.
 */
export function parseFence(languageToken: string | undefined, meta: string | undefined): FenceInfo {
  let token = (languageToken ?? '').trim();
  let filename: string | null = null;

  const colon = token.indexOf(':');
  if (colon > 0 && colon < token.length - 1) {
    filename = token.slice(colon + 1);
    token = token.slice(0, colon);
  }

  const rest = (meta ?? '').trim();
  if (!filename && rest) {
    const attr = FILENAME_ATTR.exec(rest);
    filename = attr ? (attr[1] ?? attr[2] ?? attr[3] ?? null) : null;
    if (!filename) {
      const first = rest.split(/\s+/)[0] ?? '';
      if (BARE_PATH.test(first)) filename = first;
    }
  }

  const label = token.toLowerCase();
  return { label, language: canonicalLanguage(label), filename: filename || null };
}

const EXTENSIONS: Record<string, string> = {
  typescript: 'ts',
  tsx: 'tsx',
  javascript: 'js',
  jsx: 'jsx',
  json: 'json',
  jsonc: 'json',
  html: 'html',
  css: 'css',
  scss: 'scss',
  less: 'less',
  bash: 'sh',
  python: 'py',
  rust: 'rs',
  go: 'go',
  java: 'java',
  c: 'c',
  cpp: 'cpp',
  csharp: 'cs',
  sql: 'sql',
  yaml: 'yml',
  toml: 'toml',
  markdown: 'md',
  diff: 'diff',
  xml: 'xml',
  svg: 'svg',
  mermaid: 'mmd',
  php: 'php',
  ruby: 'rb',
  swift: 'swift',
  kotlin: 'kt',
  lua: 'lua',
  powershell: 'ps1',
  graphql: 'graphql',
  vue: 'vue',
  svelte: 'svelte',
  dockerfile: 'Dockerfile',
};

/** The file name to suggest when saving: the fence's own, else `snippet.<ext>`. */
export function suggestedFilename(
  info: Pick<FenceInfo, 'language' | 'label' | 'filename'>,
): string {
  if (info.filename) return info.filename.split(/[\\/]/).pop() || info.filename;
  const ext = EXTENSIONS[info.language] ?? EXTENSIONS[info.label] ?? 'txt';
  return ext === 'Dockerfile' ? ext : `snippet.${ext}`;
}

export type PreviewKind = 'html' | 'svg' | 'mermaid' | 'markdown';

/** Which previewer, if any, can render this block. */
export function previewKind(
  info: Pick<FenceInfo, 'language' | 'label'>,
  code: string,
): PreviewKind | null {
  switch (info.label) {
    case 'svg':
      return 'svg';
    case 'html':
    case 'htm':
      return 'html';
    case 'mermaid':
      return 'mermaid';
    case 'markdown':
    case 'md':
      return 'markdown';
  }
  if (info.language === 'xml' && /^\s*(<\?xml[^>]*>\s*)?<svg[\s>]/i.test(code)) return 'svg';
  if (
    info.language === 'html' ||
    (info.language === '' && /^\s*<!doctype html|^\s*<html[\s>]/i.test(code))
  ) {
    return 'html';
  }
  return null;
}

/** True for unified diffs, whether or not the fence says `diff`. */
export function looksLikeDiff(info: Pick<FenceInfo, 'language'>, code: string): boolean {
  if (info.language === 'diff') return true;
  if (info.language !== '') return false;
  return (
    /^diff --git /m.test(code) ||
    /^--- .+\n\+\+\+ .+\n@@ /m.test(code) ||
    /^@@ -\d+(,\d+)? \+\d+(,\d+)? @@/m.test(code)
  );
}

const clip = (text: string, max = 24) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);
const stripTags = (html: string) =>
  html
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/** A short, distinguishing tab title for a preview: the page title or first heading, else the kind. */
export function previewTitle(kind: PreviewKind, code: string): string {
  switch (kind) {
    case 'html': {
      const title =
        /<title[^>]*>([\s\S]*?)<\/title>/i.exec(code)?.[1] ??
        /<h[1-3][^>]*>([\s\S]*?)<\/h[1-3]>/i.exec(code)?.[1];
      const text = title ? stripTags(title) : '';
      return text ? clip(text) : 'HTML';
    }
    case 'markdown': {
      const heading = /^#{1,3}\s+(.+)$/m.exec(code)?.[1]?.trim();
      return heading ? clip(heading) : 'Markdown';
    }
    case 'mermaid': {
      const type =
        /^\s*(graph|flowchart|sequenceDiagram|classDiagram|stateDiagram(?:-v2)?|erDiagram|gantt|pie|journey|gitGraph|mindmap|timeline)/m.exec(
          code,
        )?.[1];
      return type ? `Mermaid ${type.replace(/Diagram$/, '')}` : 'Mermaid';
    }
    case 'svg':
      return 'SVG';
  }
}
