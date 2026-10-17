import type { HighlighterCore, ThemedToken } from 'shiki/core';

/**
 * The Shiki highlighter itself, loaded on demand: the engine and each grammar
 * are separate chunks fetched the first time a block needs them. This module is
 * imported by the worker (normal path) and by `highlight.ts` (fallback where
 * workers do not exist, i.e. unit tests); the rest of the app uses `highlight.ts`.
 *
 * Colors come from a CSS-variables theme, so tokens carry `var(--shiki-…)`
 * instead of fixed colors. The light/dark values live in styles/index.css, which
 * means a theme switch recolors existing blocks instantly with no re-highlighting.
 */

export type { ThemedToken };
export type HighlightedLines = ThemedToken[][];

type Loader = () => Promise<{ default: unknown }>;

/** Curated grammar set: explicit imports keep every language a lazy chunk and unknown ones plain. */
const LOADERS: Record<string, Loader> = {
  typescript: () => import('shiki/langs/typescript.mjs'),
  tsx: () => import('shiki/langs/tsx.mjs'),
  javascript: () => import('shiki/langs/javascript.mjs'),
  jsx: () => import('shiki/langs/jsx.mjs'),
  json: () => import('shiki/langs/json.mjs'),
  jsonc: () => import('shiki/langs/jsonc.mjs'),
  html: () => import('shiki/langs/html.mjs'),
  css: () => import('shiki/langs/css.mjs'),
  scss: () => import('shiki/langs/scss.mjs'),
  less: () => import('shiki/langs/less.mjs'),
  bash: () => import('shiki/langs/bash.mjs'),
  python: () => import('shiki/langs/python.mjs'),
  rust: () => import('shiki/langs/rust.mjs'),
  go: () => import('shiki/langs/go.mjs'),
  java: () => import('shiki/langs/java.mjs'),
  c: () => import('shiki/langs/c.mjs'),
  cpp: () => import('shiki/langs/cpp.mjs'),
  csharp: () => import('shiki/langs/csharp.mjs'),
  sql: () => import('shiki/langs/sql.mjs'),
  yaml: () => import('shiki/langs/yaml.mjs'),
  toml: () => import('shiki/langs/toml.mjs'),
  markdown: () => import('shiki/langs/markdown.mjs'),
  diff: () => import('shiki/langs/diff.mjs'),
  xml: () => import('shiki/langs/xml.mjs'),
  dockerfile: () => import('shiki/langs/dockerfile.mjs'),
  php: () => import('shiki/langs/php.mjs'),
  ruby: () => import('shiki/langs/ruby.mjs'),
  swift: () => import('shiki/langs/swift.mjs'),
  kotlin: () => import('shiki/langs/kotlin.mjs'),
  lua: () => import('shiki/langs/lua.mjs'),
  powershell: () => import('shiki/langs/powershell.mjs'),
  graphql: () => import('shiki/langs/graphql.mjs'),
  vue: () => import('shiki/langs/vue.mjs'),
  svelte: () => import('shiki/langs/svelte.mjs'),
  ini: () => import('shiki/langs/ini.mjs'),
  make: () => import('shiki/langs/make.mjs'),
  mermaid: () => import('shiki/langs/mermaid.mjs'),
};

/** Language ids the highlighter can handle (after canonicalization). */
export function isHighlightable(language: string): boolean {
  return language in LOADERS;
}

const THEME_NAME = 'command-center';

let highlighter: Promise<HighlighterCore> | undefined;
const loaded = new Map<string, Promise<void>>();

function getHighlighter(): Promise<HighlighterCore> {
  highlighter ??= (async () => {
    const [{ createHighlighterCore, createCssVariablesTheme }, { createJavaScriptRegexEngine }] =
      await Promise.all([import('shiki/core'), import('shiki/engine/javascript')]);
    return createHighlighterCore({
      themes: [createCssVariablesTheme({ name: THEME_NAME, variablePrefix: '--shiki-' })],
      langs: [],
      // The JS regex engine avoids shipping the ~600 KB WASM Oniguruma build.
      engine: createJavaScriptRegexEngine({ forgiving: true }),
    });
  })();
  return highlighter;
}

function ensureLanguage(hl: HighlighterCore, language: string): Promise<void> {
  let pending = loaded.get(language);
  if (!pending) {
    const load = LOADERS[language] as Loader;
    pending = load()
      .then((mod) => hl.loadLanguage(mod.default as never))
      .catch((err: unknown) => {
        loaded.delete(language);
        throw err;
      });
    loaded.set(language, pending);
  }
  return pending;
}

/**
 * Tokenizes `code`. Resolves null when the language is unknown or fails to load,
 * so callers fall back to plain text instead of erroring.
 */
export async function highlightCode(
  code: string,
  language: string,
): Promise<HighlightedLines | null> {
  if (!isHighlightable(language)) return null;
  try {
    const hl = await getHighlighter();
    await ensureLanguage(hl, language);
    return hl.codeToTokensBase(code, { lang: language, theme: THEME_NAME });
  } catch (err) {
    console.warn(`[highlight] ${language} unavailable:`, err);
    return null;
  }
}

/** Loads the engine and the most common grammars ahead of the first block. */
export async function preload(): Promise<void> {
  const hl = await getHighlighter();
  await Promise.all(['typescript', 'json', 'bash'].map((l) => ensureLanguage(hl, l)));
}
