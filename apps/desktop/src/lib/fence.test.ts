import { describe, expect, it } from 'vitest';
import {
  canonicalLanguage,
  looksLikeDiff,
  parseFence,
  previewKind,
  previewTitle,
  suggestedFilename,
} from './fence';

describe('parseFence', () => {
  it('reads plain languages and aliases', () => {
    expect(parseFence('ts', undefined)).toEqual({
      label: 'ts',
      language: 'typescript',
      filename: null,
    });
    expect(parseFence('Python', '')).toMatchObject({ language: 'python' });
    expect(parseFence('yml', undefined).language).toBe('yaml');
    expect(parseFence(undefined, undefined)).toEqual({ label: '', language: '', filename: null });
    expect(parseFence('text', undefined).language).toBe('');
  });

  it('reads file names in the supported spellings', () => {
    expect(parseFence('ts', 'title="src/a.ts"').filename).toBe('src/a.ts');
    expect(parseFence('ts', "filename='b c.ts'").filename).toBe('b c.ts');
    expect(parseFence('ts', 'file=a.ts {1,3}').filename).toBe('a.ts');
    expect(parseFence('ts:src/a.ts', undefined)).toMatchObject({
      language: 'typescript',
      filename: 'src/a.ts',
    });
    expect(parseFence('ts', 'src/index.ts').filename).toBe('src/index.ts');
  });

  it('does not mistake other meta for a file name', () => {
    expect(parseFence('ts', 'showLineNumbers').filename).toBeNull();
    expect(parseFence('ts', '{1,3}').filename).toBeNull();
  });
});

describe('suggestedFilename', () => {
  it('prefers the fence file name, keeping only the base name', () => {
    expect(suggestedFilename({ language: 'typescript', label: 'ts', filename: 'src/a.ts' })).toBe(
      'a.ts',
    );
  });
  it('falls back to snippet.<ext>', () => {
    expect(suggestedFilename({ language: 'python', label: 'py', filename: null })).toBe(
      'snippet.py',
    );
    expect(suggestedFilename({ language: '', label: '', filename: null })).toBe('snippet.txt');
    expect(suggestedFilename({ language: 'dockerfile', label: 'dockerfile', filename: null })).toBe(
      'Dockerfile',
    );
  });
});

describe('previewKind', () => {
  const kind = (label: string, code = '') =>
    previewKind({ label, language: canonicalLanguage(label) }, code);
  it('recognizes the four previewable kinds', () => {
    expect(kind('html')).toBe('html');
    expect(kind('svg')).toBe('svg');
    expect(kind('mermaid')).toBe('mermaid');
    expect(kind('md')).toBe('markdown');
  });
  it('detects svg inside xml and html without a language', () => {
    expect(kind('xml', '<?xml version="1.0"?>\n<svg width="1"></svg>')).toBe('svg');
    expect(kind('xml', '<config/>')).toBeNull();
    expect(kind('', '<!DOCTYPE html><p>x')).toBe('html');
  });
  it('is null for ordinary code', () => {
    expect(kind('ts', 'const a = 1')).toBeNull();
  });
});

describe('looksLikeDiff', () => {
  const info = (label: string) => ({ language: canonicalLanguage(label) });
  it('trusts the diff and patch languages', () => {
    expect(looksLikeDiff(info('diff'), 'anything')).toBe(true);
    expect(looksLikeDiff(info('patch'), 'anything')).toBe(true);
  });
  it('sniffs unlabeled blocks but never relabels other languages', () => {
    expect(looksLikeDiff(info(''), '--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b')).toBe(true);
    expect(looksLikeDiff(info(''), 'diff --git a/x b/x\n')).toBe(true);
    expect(looksLikeDiff(info(''), 'just text')).toBe(false);
    expect(looksLikeDiff(info('ts'), '--- a/x\n+++ b/x\n@@ -1 +1 @@')).toBe(false);
  });
});

describe('previewTitle', () => {
  it('uses the page title, else the first heading, else the kind', () => {
    expect(previewTitle('html', '<html><head><title>Dashboard</title></head></html>')).toBe(
      'Dashboard',
    );
    expect(previewTitle('html', '<div><h1 class="x">Hello <b>world</b></h1></div>')).toBe(
      'Hello world',
    );
    expect(previewTitle('html', '<p>plain</p>')).toBe('HTML');
    expect(previewTitle('html', `<h1>${'long '.repeat(20)}</h1>`).length).toBeLessThanOrEqual(24);
  });
  it('names diagrams by type and markdown by heading', () => {
    expect(previewTitle('mermaid', 'sequenceDiagram\n  A->>B: hi')).toBe('Mermaid sequence');
    expect(previewTitle('mermaid', 'graph TD\n A-->B')).toBe('Mermaid graph');
    expect(previewTitle('mermaid', 'nonsense')).toBe('Mermaid');
    expect(previewTitle('markdown', 'intro\n\n## Release notes')).toBe('Release notes');
    expect(previewTitle('markdown', 'no headings')).toBe('Markdown');
    expect(previewTitle('svg', '<svg/>')).toBe('SVG');
  });
});
