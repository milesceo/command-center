// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Message } from '../../lib/types';
import { chatStore } from '../../stores/chat';
import { previewStore } from '../../stores/preview';
import { useUiStore } from '../../stores/ui';
import { Markdown } from '../chat/Markdown';

const saveTextFile = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('../../lib/save-file', () => ({ saveTextFile }));

const writeText = vi.fn(() => Promise.resolve());

beforeEach(() => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  writeText.mockClear();
  saveTextFile.mockClear();
  previewStore.setState({ tabs: [], activeId: null, compare: null });
  useUiStore.setState({ rightPanelOpen: false, wrapCode: false, diffMode: 'split' });
  chatStore.setState({ messages: [], streams: {}, loadedFor: null, errors: {} });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

const fence = (lang: string, body: string, meta = '') =>
  `\`\`\`${lang}${meta ? ` ${meta}` : ''}\n${body}\n\`\`\``;
const lines = (n: number) => Array.from({ length: n }, (_, i) => `const v${i} = ${i};`).join('\n');
const block = () => screen.getByTestId('code-block');

describe('CodeBlock', () => {
  it('shows the language, file name, line numbers and Shiki tokens', async () => {
    render(
      <Markdown
        text={fence('ts', 'const a = 1;\nconsole.log(a);', 'title="src/a.ts"')}
        messageId="m1"
      />,
    );
    expect(within(block()).getByText('ts')).toBeTruthy();
    expect(within(block()).getByText('src/a.ts')).toBeTruthy();
    expect(block().querySelectorAll('.code-ln')).toHaveLength(2);
    await waitFor(() => {
      const colored = [...block().querySelectorAll<HTMLElement>('.code-lc span')].filter((s) =>
        s.style.color.includes('--shiki-token-keyword'),
      );
      expect(colored.length).toBeGreaterThan(0);
    });
  });

  it('copies the code without line numbers', async () => {
    render(<Markdown text={fence('ts', 'const a = 1;\nconst b = 2;')} messageId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Copy code' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('const a = 1;\nconst b = 2;'));
  });

  it('toggles line wrapping (a shared preference)', () => {
    render(<Markdown text={fence('ts', 'const a = 1;')} messageId="m1" />);
    expect(block().querySelector('.code-wrap')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Toggle line wrap' }));
    expect(useUiStore.getState().wrapCode).toBe(true);
    expect(block().querySelector('.code-wrap')).not.toBeNull();
  });

  it('collapses long blocks and expands on demand', () => {
    render(<Markdown text={fence('ts', lines(40))} messageId="m1" />);
    expect(block().querySelectorAll('.code-line')).toHaveLength(16);
    fireEvent.click(screen.getByRole('button', { name: /show 24 more lines/i }));
    expect(block().querySelectorAll('.code-line')).toHaveLength(40);
    fireEvent.click(screen.getByRole('button', { name: /collapse/i }));
    expect(block().querySelectorAll('.code-line')).toHaveLength(16);
  });

  it('does not collapse a block whose reply is still streaming', () => {
    render(<Markdown text={fence('ts', lines(40))} messageId="m1" streaming />);
    expect(block().querySelectorAll('.code-line')).toHaveLength(40);
  });

  it('saves with the fence file name, or snippet.<ext>', async () => {
    const { unmount } = render(
      <Markdown text={fence('ts', 'a', 'filename=src/app.ts')} messageId="m1" />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Save as file' }));
    await waitFor(() => expect(saveTextFile).toHaveBeenCalledWith('app.ts', 'a'));
    unmount();
    render(<Markdown text={fence('python', 'print(1)')} messageId="m2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Save as file' }));
    await waitFor(() => expect(saveTextFile).toHaveBeenLastCalledWith('snippet.py', 'print(1)'));
  });
});

describe('open in preview', () => {
  it('is offered only for previewable languages', () => {
    const { unmount } = render(<Markdown text={fence('ts', 'a')} messageId="m1" />);
    expect(screen.queryByRole('button', { name: 'Open in preview' })).toBeNull();
    unmount();
    render(<Markdown text={fence('html', '<p>hi</p>')} messageId="m2" />);
    expect(screen.getByRole('button', { name: 'Open in preview' })).toBeTruthy();
  });

  it.each([
    ['html', '<p>hi</p>', 'html'],
    ['svg', '<svg></svg>', 'svg'],
    ['mermaid', 'graph TD; A-->B', 'mermaid'],
    ['markdown', '# Title', 'markdown'],
  ])('opens a %s block as a tab and reveals the panel', (lang, body, kind) => {
    render(<Markdown text={fence(lang, body)} messageId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Open in preview' }));
    expect(previewStore.getState().tabs[0]).toMatchObject({ kind, source: body });
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
  });

  it('keeps the tab updated, debounced, while the block grows', () => {
    vi.useFakeTimers();
    const { rerender } = render(
      <Markdown text={fence('html', '<p>one</p>')} messageId="m1" streaming />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Open in preview' }));
    rerender(<Markdown text={fence('html', '<p>one two</p>')} messageId="m1" streaming />);
    rerender(<Markdown text={fence('html', '<p>one two three</p>')} messageId="m1" streaming />);
    expect(previewStore.getState().tabs[0]?.source).toBe('<p>one</p>');
    act(() => void vi.advanceTimersByTime(300));
    expect(previewStore.getState().tabs[0]?.source).toBe('<p>one two three</p>');
    expect(previewStore.getState().tabs[0]?.version).toBe(2); // one refresh, not one per chunk
  });
});

describe('comparing code', () => {
  it('compares two picked blocks', () => {
    render(
      <Markdown
        text={`${fence('ts', 'const a = 1;', 'title="old.ts"')}\n\n${fence('ts', 'const a = 2;', 'title="new.ts"')}`}
        messageId="m1"
      />,
    );
    const [first, second] = screen.getAllByRole('button', {
      name: /compare with another code block|compare with/i,
    });
    fireEvent.click(first as HTMLElement);
    expect(previewStore.getState().compare).toMatchObject({ title: 'old.ts' });
    fireEvent.click(second as HTMLElement);
    expect(previewStore.getState().compare).toBeNull();
    expect(previewStore.getState().tabs[0]).toMatchObject({
      kind: 'diff',
      diff: {
        type: 'compare',
        before: 'const a = 1;',
        after: 'const a = 2;',
        beforeName: 'old.ts',
        afterName: 'new.ts',
      },
    });
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
  });

  it('picking the same block again cancels', () => {
    render(<Markdown text={fence('ts', 'a')} messageId="m1" />);
    fireEvent.click(screen.getByRole('button', { name: 'Compare with another block' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel comparison' }));
    expect(previewStore.getState().compare).toBeNull();
    expect(previewStore.getState().tabs).toHaveLength(0);
  });

  it('offers a diff against the earlier version of a block in the conversation', () => {
    const earlier = 'export function sum(a, b) {\n  return a + b;\n}\n\nexport const X = 1;';
    const later =
      'export function sum(a: number, b: number) {\n  return a + b;\n}\n\nexport const X = 1;';
    const message: Message = {
      id: 'm1',
      conversationId: 'c',
      role: 'assistant',
      content: fence('ts', earlier),
      attachments: [],
      status: 'complete',
      error: null,
      model: null,
      inputTokens: null,
      outputTokens: null,
      createdAt: 1,
    };
    chatStore.setState({ messages: [message] });
    render(<Markdown text={fence('ts', later)} messageId="m2" />);
    fireEvent.click(screen.getByRole('button', { name: 'Diff against earlier version' }));
    expect(previewStore.getState().tabs[0]).toMatchObject({
      kind: 'diff',
      diff: { before: earlier, after: later },
    });
  });
});

describe('diff blocks', () => {
  const patch =
    '--- a/x.ts\n+++ b/x.ts\n@@ -1,2 +1,2 @@\n const keep = 1;\n-const total = a + b;\n+const total = a + b + c;';

  it('renders a unified diff in a reply as a diff, switchable between layouts', async () => {
    render(<Markdown text={fence('diff', patch)} messageId="m1" />);
    const diff = await screen.findByTestId('diff-block');
    expect(within(diff).getAllByText('+1').length).toBeGreaterThan(0);
    expect(diff.querySelector('[data-mode="split"]')).not.toBeNull();
    expect(diff.querySelector('mark.diff-word-add')?.textContent).toContain('+ c');
    fireEvent.click(within(diff).getByRole('button', { name: 'Inline diff' }));
    expect(diff.querySelector('[data-mode="inline"]')).not.toBeNull();
    expect(diff.querySelectorAll('[data-kind="add"]')).toHaveLength(1);
  });

  it('recognizes an unlabeled block that is a diff', async () => {
    render(<Markdown text={fence('', patch)} messageId="m1" />);
    expect(await screen.findByTestId('diff-block')).toBeTruthy();
  });

  it('opens the diff in the panel', async () => {
    render(<Markdown text={fence('diff', patch)} messageId="m1" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Open diff in preview panel' }));
    expect(previewStore.getState().tabs[0]).toMatchObject({
      kind: 'diff',
      diff: { type: 'patch' },
    });
  });
});
