// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { previewStore } from '../../stores/preview';

// In the desktop app previews are registered with the Rust side and loaded from the isolated preview: scheme.
const tauri = vi.hoisted(() => ({
  invoke: vi.fn(() => Promise.resolve(null)),
  convertFileSrc: vi.fn((id: string, scheme: string) => `${scheme}://localhost/${id}`),
}));
vi.mock('@tauri-apps/api/core', () => tauri);
vi.mock('../../lib/tauri', () => ({ isTauri: () => true }));

const { PreviewPanel } = await import('./PreviewPanel');

afterEach(cleanup);

describe('PreviewFrame in the desktop app', () => {
  it('registers the document with Rust and loads it from the preview: scheme, not srcdoc', async () => {
    previewStore.setState({ tabs: [], activeId: null });
    previewStore.getState().open({ kind: 'html', title: 'page', source: '<p id="mine">hi</p>' });
    render(<PreviewPanel />);
    const frame = (await waitFor(() => screen.getByTitle(/^Preview:/))) as HTMLIFrameElement;

    expect(tauri.invoke).toHaveBeenCalledWith(
      'preview_set',
      expect.objectContaining({ html: expect.stringContaining('<p id="mine">hi</p>') }),
    );
    const { id } = (tauri.invoke.mock.calls[0] as unknown as [string, { id: string }])[1];
    expect(frame.getAttribute('src')).toBe(`preview://localhost/${id}`);
    expect(frame.hasAttribute('srcdoc')).toBe(false);
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });
});
