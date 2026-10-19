// @vitest-environment jsdom
// titleFromHtml in a DOM environment (the webview): it uses DOMParser instead of the regex.
import { describe, expect, it } from 'vitest';
import { MAX_TITLE, titleFromHtml } from './repo-plans';

describe('titleFromHtml with DOMParser', () => {
  it('uses DOMParser in this environment', () => {
    expect(typeof DOMParser).toBe('function');
  });

  it('reads the document title, decoding entities and folding whitespace', () => {
    expect(titleFromHtml('<!doctype html><title>  Test &amp;\n  Plan &#8211; v2 </title>')).toBe(
      'Test & Plan – v2',
    );
  });

  it('ignores an SVG <title> that comes before the document title', () => {
    const html =
      '<!doctype html><html><body><svg><title>Icon label</title></svg>' +
      '<p>Body</p></body></html>';
    expect(titleFromHtml(html)).toBeNull();
    expect(
      titleFromHtml('<!doctype html><svg><title>Icon label</title></svg><title>Real title</title>'),
    ).toBe('Real title');
  });

  it('returns null for a missing, empty or whitespace-only title', () => {
    expect(titleFromHtml('<p>no title</p>')).toBeNull();
    expect(titleFromHtml('<title></title>')).toBeNull();
    expect(titleFromHtml('<title>  \n\t </title>')).toBeNull();
    expect(titleFromHtml('')).toBeNull();
  });

  it('does not run the document scripts while reading the title', () => {
    const w = window as unknown as { __planRan?: boolean };
    delete w.__planRan;
    titleFromHtml('<title>T</title><script>window.__planRan = true</script>');
    expect(w.__planRan).toBeUndefined();
  });

  it('caps a very long title', () => {
    const t = titleFromHtml(`<title>${'é'.repeat(500)}</title>`);
    expect(t).toHaveLength(MAX_TITLE);
  });
});
