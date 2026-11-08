import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  CONSOLE_SOURCE,
  PLAN_STORAGE_SOURCE,
  PREVIEW_CSP,
  buildHtmlDocument,
  buildSvgDocument,
  parseConsoleMessage,
  parsePlanStorageMessage,
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
    expect(doc.indexOf('command-center-preview')).toBeLessThan(doc.indexOf('boom()'));
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

describe('plan page storage', () => {
  /** Runs the injected storage script against a stand-in window and parent. */
  const run = (doc: string) => {
    const script = [...doc.matchAll(/<script>([\s\S]*?)<\/script>/g)]
      .map((m) => m[1] ?? '')
      .find((s) => s.includes(PLAN_STORAGE_SOURCE));
    if (!script) throw new Error('no storage script');
    const sent: unknown[] = [];
    const win: Record<string, unknown> = {
      get localStorage(): never {
        throw new Error('SecurityError');
      },
    };
    const parent = { postMessage: (m: unknown) => sent.push(m) };
    new Function('window', 'parent', script)(win, parent);
    return { storage: win.localStorage as Storage, sent };
  };

  it('is only added for plans', () => {
    expect(buildHtmlDocument('x', 'f')).not.toContain(PLAN_STORAGE_SOURCE);
    expect(buildHtmlDocument('x', 'f', {})).toContain(PLAN_STORAGE_SOURCE);
  });

  it('gives the page a localStorage seeded with what was saved, and sends every change', () => {
    const { storage, sent } = run(buildHtmlDocument('x', 'plan-1', { a: '1' }));
    expect(storage.getItem('a')).toBe('1');
    expect(storage.getItem('missing')).toBeNull();
    storage.setItem('b', '2');
    expect(storage.length).toBe(2);
    expect(storage.key(1)).toBe('b');
    expect(storage.key(5)).toBeNull();
    storage.removeItem('a');
    expect(sent.at(-1)).toEqual({ source: PLAN_STORAGE_SOURCE, id: 'plan-1', items: { b: '2' } });
    storage.clear();
    expect(sent.at(-1)).toEqual({ source: PLAN_STORAGE_SOURCE, id: 'plan-1', items: {} });
    expect(sent).toHaveLength(3);
  });

  it('cannot be broken out of through saved values', () => {
    const doc = buildHtmlDocument('x', 'f', { k: '</script><script>alert(1)</script>' });
    expect(doc).not.toContain('</script><script>alert(1)');
    expect(run(doc).storage.getItem('k')).toBe('</script><script>alert(1)</script>');
  });

  it('keeps a saved key named __proto__ as an ordinary key', () => {
    const { storage } = run(buildHtmlDocument('x', 'f', JSON.parse('{"__proto__":"p"}')));
    expect(storage.getItem('__proto__')).toBe('p');
  });

  it('accepts only well-formed messages for the expected frame', () => {
    const ok = { source: PLAN_STORAGE_SOURCE, id: 'plan-1', items: { a: 'b' } };
    expect(parsePlanStorageMessage(ok, 'plan-1')).toEqual({ a: 'b' });
    expect(parsePlanStorageMessage(ok, 'plan-2')).toBeNull();
    expect(parsePlanStorageMessage({ ...ok, source: CONSOLE_SOURCE }, 'plan-1')).toBeNull();
    expect(parsePlanStorageMessage({ ...ok, items: { a: 1 } }, 'plan-1')).toBeNull();
    expect(parsePlanStorageMessage('nope', 'plan-1')).toBeNull();
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
