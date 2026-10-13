// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { previewStore } from '../../stores/preview';
import { useUiStore } from '../../stores/ui';

const mermaid = vi.hoisted(() => ({ renderMermaid: vi.fn() }));
vi.mock('../../lib/mermaid', () => mermaid);

const { PreviewPanel } = await import('./PreviewPanel');

beforeEach(() => {
  previewStore.setState({
    tabs: [],
    activeId: null,
    viewport: 'desktop',
    consoleOpen: false,
    compare: null,
  });
  useUiStore.setState({ rightPanelOpen: true, theme: 'dark', diffMode: 'split' });
  mermaid.renderMermaid.mockReset();
});
afterEach(cleanup);

const openHtml = (source: string, title = 'page') =>
  previewStore.getState().open({ kind: 'html', title, source });
const iframe = () => screen.getByTitle(/^Preview:/) as HTMLIFrameElement;
const frameIdOf = (el: HTMLIFrameElement) =>
  /var ID="([^"]+)"/.exec(el.getAttribute('srcdoc') ?? '')?.[1] as string;

function postFromFrame(el: HTMLIFrameElement, data: unknown) {
  act(() => {
    window.dispatchEvent(new MessageEvent('message', { data, source: el.contentWindow }));
  });
}

describe('PreviewPanel', () => {
  it('shows an empty state with a hint', () => {
    render(<PreviewPanel />);
    expect(screen.getByText(/open an html, svg, mermaid or markdown code block/i)).toBeTruthy();
  });

  it('runs HTML in an iframe that is sandboxed without same-origin access', async () => {
    openHtml('<h1 id="x">Hello</h1><script>console.log(1)</script>');
    render(<PreviewPanel />);
    await waitFor(() => iframe());
    const frame = iframe();
    // Only scripts are allowed: no allow-same-origin (opaque origin), top-navigation, popups, forms or modals.
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(frame.getAttribute('referrerpolicy')).toBe('no-referrer');
    expect(frame.getAttribute('srcdoc')).toContain('<h1 id="x">Hello</h1>');
    expect(frame.getAttribute('srcdoc')).toContain("connect-src 'none'");
  });

  it('shows console output and errors from the frame, only from the right frame', async () => {
    openHtml('<p>x</p>');
    render(<PreviewPanel />);
    await waitFor(() => iframe());
    const frame = iframe();
    const id = frameIdOf(frame);

    fireEvent.click(screen.getByRole('button', { name: 'Toggle console' }));
    postFromFrame(frame, {
      source: 'programish-preview',
      id,
      level: 'log',
      text: 'hello from the page',
    });
    postFromFrame(frame, {
      source: 'programish-preview',
      id,
      level: 'error',
      text: 'ReferenceError: nope',
    });
    // A message tagged with another frame's id, or sent by another window, is ignored.
    postFromFrame(frame, {
      source: 'programish-preview',
      id: 'stale',
      level: 'log',
      text: 'old frame',
    });
    act(() => {
      window.dispatchEvent(
        new MessageEvent('message', {
          data: { source: 'programish-preview', id, level: 'log', text: 'spoof' },
          source: window,
        }),
      );
    });

    const log = screen.getByRole('log');
    expect(log.textContent).toContain('hello from the page');
    expect(log.textContent).toContain('error: ReferenceError: nope');
    expect(log.textContent).not.toContain('old frame');
    expect(log.textContent).not.toContain('spoof');
    expect(screen.getByLabelText('has errors')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Clear console' }));
    expect(screen.getByText('No output.')).toBeTruthy();
  });

  it('refresh re-runs the page in a fresh frame and clears the console', async () => {
    const id = openHtml('<p>x</p>');
    render(<PreviewPanel />);
    await waitFor(() => iframe());
    const before = frameIdOf(iframe());
    previewStore.getState().addLog(id, { level: 'log', text: 'old', at: 1 });
    fireEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
    await waitFor(() => expect(frameIdOf(iframe())).not.toBe(before));
    expect(previewStore.getState().tabs[0]?.logs).toEqual([]);
  });

  it('switches the viewport width', async () => {
    openHtml('<p>x</p>');
    render(<PreviewPanel />);
    await waitFor(() => iframe());
    const stage = () => screen.getByTestId('preview-stage').firstElementChild as HTMLElement;
    fireEvent.click(screen.getByRole('button', { name: /mobile/i }));
    expect(stage().style.width).toBe('375px');
    fireEvent.click(screen.getByRole('button', { name: /tablet/i }));
    expect(stage().style.width).toBe('768px');
    fireEvent.click(screen.getByRole('button', { name: /desktop/i }));
    expect(stage().style.width).toBe('100%');
  });

  it('follows code updates (streaming) with a new frame', async () => {
    openHtml('<p>one</p>');
    render(<PreviewPanel />);
    await waitFor(() => iframe());
    act(() =>
      previewStore.getState().updateSource(previewStore.getState().tabs[0]!.id, '<p>two</p>'),
    );
    await waitFor(() => expect(iframe().getAttribute('srcdoc')).toContain('<p>two</p>'));
  });

  it('manages several tabs', async () => {
    openHtml('<p>a</p>', 'first');
    openHtml('<p>b</p>', 'second');
    render(<PreviewPanel />);
    await waitFor(() => expect(iframe().getAttribute('srcdoc')).toContain('<p>b</p>'));
    fireEvent.click(screen.getByRole('tab', { name: 'first' }));
    await waitFor(() => expect(iframe().getAttribute('srcdoc')).toContain('<p>a</p>'));
    fireEvent.click(screen.getByRole('button', { name: 'Close first' }));
    expect(screen.queryByRole('tab', { name: 'first' })).toBeNull();
  });
});

describe('other preview kinds', () => {
  it('renders SVG in the sandbox', async () => {
    previewStore.getState().open({
      kind: 'svg',
      title: 'logo',
      source: '<svg viewBox="0 0 1 1"><rect width="1" height="1"/></svg>',
    });
    render(<PreviewPanel />);
    await waitFor(() =>
      expect(iframe().getAttribute('srcdoc')).toContain('<rect width="1" height="1"/>'),
    );
    expect(iframe().getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('renders Mermaid via the lazy renderer, inside the same sandbox', async () => {
    mermaid.renderMermaid.mockResolvedValue('<svg id="diagram"></svg>');
    previewStore.getState().open({ kind: 'mermaid', title: 'flow', source: 'graph TD; A-->B' });
    render(<PreviewPanel />);
    await waitFor(() => expect(iframe().getAttribute('srcdoc')).toContain('<svg id="diagram">'));
    expect(mermaid.renderMermaid).toHaveBeenCalledWith('graph TD; A-->B', 'dark');
    expect(iframe().getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('reports a diagram syntax error instead of a blank panel', async () => {
    mermaid.renderMermaid.mockRejectedValue(new Error('Parse error on line 1'));
    previewStore.getState().open({ kind: 'mermaid', title: 'bad', source: 'nonsense' });
    render(<PreviewPanel />);
    expect((await screen.findByRole('alert')).textContent).toContain('Parse error on line 1');
    expect(previewStore.getState().tabs[0]?.logs[0]).toMatchObject({ level: 'error' });
  });

  it('renders Markdown without an iframe', () => {
    previewStore
      .getState()
      .open({ kind: 'markdown', title: 'readme', source: '# Title\n\nSome **bold** text' });
    render(<PreviewPanel />);
    expect(screen.getByRole('heading', { name: 'Title' })).toBeTruthy();
    expect(screen.queryByTitle(/^Preview:/)).toBeNull();
  });

  it('renders a compared diff in a tab', async () => {
    previewStore.getState().openDiff({
      title: 'a → b',
      diff: {
        type: 'compare',
        before: 'one\ntwo',
        after: 'one\n2',
        beforeName: 'a',
        afterName: 'b',
      },
    });
    render(<PreviewPanel />);
    expect(await screen.findByTestId('diff-file')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Inline diff' })).toBeTruthy();
  });
});
