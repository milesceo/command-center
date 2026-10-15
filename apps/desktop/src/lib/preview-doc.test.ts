import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_SOURCE,
  PREVIEW_CSP,
  buildHtmlDocument,
  buildSvgDocument,
  parseConsoleMessage,
} from './preview-doc';

describe('buildHtmlDocument', () => {
  it('wraps a fragment in a full page with the hook, the CSP and the content', () => {
    const doc = buildHtmlDocument('<h1>Hi</h1>', 'f1');
    expect(doc).toMatch(/^<!doctype html>/);
    expect(doc).toContain('<h1>Hi</h1>');
    expect(doc).toContain('Content-Security-Policy');
    expect(doc).toContain('"f1"');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<h1>'));
  });

  it('injects into an existing head, before the author scripts', () => {
    const doc = buildHtmlDocument(
      '<!doctype html><html><head><title>t</title><script>boom()</script></head><body></body></html>',
      'f2',
    );
    expect(doc.indexOf('geeked-preview')).toBeLessThan(doc.indexOf('boom()'));
    expect(doc.match(/<head/g)).toHaveLength(1);
  });

  it('adds a head when the document has none', () => {
    const doc = buildHtmlDocument('<!doctype html><html><body>x</body></html>', 'f3');
    expect(doc).toContain('<head>');
    expect(doc.indexOf('Content-Security-Policy')).toBeLessThan(doc.indexOf('<body>'));
  });

  it('cannot be broken out of through the frame id', () => {
    const doc = buildHtmlDocument('x', '</script><script>alert(1)</script>');
    expect(doc).not.toContain('</script><script>alert(1)');
  });
});

describe('buildSvgDocument', () => {
  it('strips the XML prolog and themes the background', () => {
    const doc = buildSvgDocument(
      '<?xml version="1.0"?>\n<svg viewBox="0 0 1 1"></svg>',
      'f',
      'dark',
    );
    expect(doc).not.toContain('<?xml');
    expect(doc).toContain('<svg');
    expect(doc).toContain('#111114');
    expect(buildSvgDocument('<svg/>', 'f', 'light')).toContain('#ffffff');
  });
});

describe('parseConsoleMessage', () => {
  const good = { source: CONSOLE_SOURCE, id: 'f1', level: 'warn', text: 'careful' };
  it('accepts a well-formed message for the expected frame', () => {
    expect(parseConsoleMessage(good, 'f1', 5)).toEqual({ level: 'warn', text: 'careful', at: 5 });
  });
  it('rejects other frames, other sources and malformed data', () => {
    expect(parseConsoleMessage(good, 'other')).toBeNull();
    expect(parseConsoleMessage({ ...good, source: 'x' }, 'f1')).toBeNull();
    expect(parseConsoleMessage({ ...good, level: 'fatal' }, 'f1')).toBeNull();
    expect(parseConsoleMessage({ ...good, text: 1 }, 'f1')).toBeNull();
    expect(parseConsoleMessage('log', 'f1')).toBeNull();
    expect(parseConsoleMessage(null, 'f1')).toBeNull();
  });
  it('caps very long text', () => {
    expect(parseConsoleMessage({ ...good, text: 'a'.repeat(9000) }, 'f1')?.text).toHaveLength(4000);
  });
});

describe('PREVIEW_CSP', () => {
  it('matches the policy the Rust protocol handler sends as a header', () => {
    const rust = readFileSync(join(process.cwd(), 'src-tauri/src/preview.rs'), 'utf8');
    expect(rust).toContain(PREVIEW_CSP);
  });
  it('blocks network access and cannot be framed into anything', () => {
    expect(PREVIEW_CSP).toContain("connect-src 'none'");
    expect(PREVIEW_CSP).toContain("default-src 'none'");
  });
});
