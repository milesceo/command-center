import { useEffect, useRef, useState } from 'react';
import { renderMermaid } from '../../lib/mermaid';
import { buildHtmlDocument, buildSvgDocument, parseConsoleMessage } from '../../lib/preview-doc';
import { isTauri } from '../../lib/tauri';
import { previewStore, VIEWPORT_WIDTHS, usePreview, type PreviewTab } from '../../stores/preview';
import { useUiStore } from '../../stores/ui';

interface Frame {
  /** Unique per build; the page tags its console messages with it and stale ones are dropped. */
  id: string;
  src?: string;
  srcDoc?: string;
}

let builds = 0;

/**
 * Hands the document to the iframe. In the desktop app it is registered with the
 * Rust side and loaded from the isolated `preview:` scheme; in a plain browser
 * (web preview, tests) it falls back to `srcdoc`.
 */
async function publish(id: string, html: string): Promise<Frame> {
  if (isTauri()) {
    const { invoke, convertFileSrc } = await import('@tauri-apps/api/core');
    await invoke('preview_set', { id, html });
    return { id, src: convertFileSrc(id, 'preview') };
  }
  return { id, srcDoc: html };
}

/**
 * The sandboxed preview for HTML, SVG and Mermaid tabs.
 *
 * `sandbox="allow-scripts"` deliberately omits `allow-same-origin`, `allow-top-navigation`,
 * `allow-popups`, `allow-forms` and `allow-modals`: the previewed page runs scripts in an
 * opaque origin and cannot touch the app, its storage, the Tauri IPC or the bridge.
 */
export function PreviewFrame({ tab }: { tab: PreviewTab }) {
  const theme = useUiStore((s) => s.theme);
  const viewport = usePreview((s) => s.viewport);
  const [frame, setFrame] = useState<Frame | null>(null);
  const [error, setError] = useState<string | null>(null);
  const iframe = useRef<HTMLIFrameElement>(null);

  // Rebuild whenever the code changes, a refresh is requested, or (for diagrams/SVG) the theme changes.
  useEffect(() => {
    let current = true;
    const id = `${tab.id}-${tab.version}-${++builds}`;
    void (async () => {
      try {
        let html: string;
        if (tab.kind === 'html') {
          html = buildHtmlDocument(tab.source, id);
        } else if (tab.kind === 'svg') {
          html = buildSvgDocument(tab.source, id, theme);
        } else {
          html = buildSvgDocument(await renderMermaid(tab.source, theme), id, theme);
        }
        const next = await publish(id, html);
        if (current) {
          setError(null);
          setFrame(next);
        }
      } catch (err) {
        if (!current) return;
        const message = err instanceof Error ? err.message : String(err);
        setError(message);
        previewStore.getState().addLog(tab.id, { level: 'error', text: message, at: Date.now() });
      }
    })();
    return () => {
      current = false;
    };
  }, [tab.id, tab.kind, tab.source, tab.version, theme]);

  // Console output and errors sent up by the page. Only messages from our own frame, tagged with its id, are accepted.
  useEffect(() => {
    if (!frame) return;
    const onMessage = (event: MessageEvent) => {
      if (event.source !== iframe.current?.contentWindow) return;
      const entry = parseConsoleMessage(event.data, frame.id);
      if (entry) previewStore.getState().addLog(tab.id, entry);
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, [frame, tab.id]);

  const width = VIEWPORT_WIDTHS[viewport];
  return (
    <div
      className="relative flex min-h-0 flex-1 justify-center overflow-auto bg-bg p-3"
      data-testid="preview-stage"
    >
      <div
        className="h-full overflow-hidden rounded-control border border-border bg-white shadow-sm"
        style={{ width: width ?? '100%', maxWidth: '100%' }}
        data-viewport={viewport}
      >
        {frame && (
          <iframe
            key={frame.id}
            ref={iframe}
            title={`Preview: ${tab.title}`}
            sandbox="allow-scripts"
            referrerPolicy="no-referrer"
            {...(frame.src ? { src: frame.src } : { srcDoc: frame.srcDoc ?? '' })}
            className="h-full w-full border-0 bg-white"
          />
        )}
      </div>
      {error && (
        <div
          role="alert"
          className="absolute inset-x-3 bottom-3 max-h-40 overflow-auto rounded-control border border-danger bg-elevated p-2 font-mono text-xs text-danger"
        >
          {tab.kind === 'mermaid' ? 'Diagram error: ' : 'Preview error: '}
          {error}
        </div>
      )}
    </div>
  );
}
