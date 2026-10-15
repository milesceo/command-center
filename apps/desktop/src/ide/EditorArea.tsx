import { ChevronRight, FileCode2, X } from 'lucide-react';
import { lazy, Suspense, useEffect, useRef } from 'react';
import { ViewSkeleton } from '../components/ui/skeleton';
import { cn } from '../lib/cn';
import { formatAgo } from '../lib/format';
import { formatKeys, isMacPlatform } from '../lib/shortcuts';
import { conversationsStore, useConversations } from '../stores/conversations';
import { useIdeStore } from '../stores/ide';
import { useProjects } from '../stores/projects';
import { useUiStore, type View } from '../stores/ui';
import { FileViewer } from './shared/FileViewer';
import { LandingView } from '../components/landing/LandingView';
import { useActiveFiles, useNewestFileKey } from './shared/hooks';

// Secondary views load on first visit, as in the classic layout.
const UsageView = lazy(() =>
  import('../components/usage/UsageView').then((m) => ({ default: m.UsageView })),
);
const PromptsView = lazy(() =>
  import('../components/prompts/PromptsView').then((m) => ({ default: m.PromptsView })),
);
const SettingsView = lazy(() =>
  import('../components/settings/SettingsView').then((m) => ({ default: m.SettingsView })),
);

const VIEW_TITLES: Record<Exclude<View, 'chat' | 'landing'>, string> = {
  usage: 'Usage',
  prompts: 'Prompt library',
  settings: 'Settings',
};

const NONE: string[] = [];

const paneClass =
  'flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden rounded-panel border border-border bg-surface';

/** The central editor: file tabs for the open thread, or one of the secondary views. */
export function EditorArea() {
  const view = useUiStore((s) => s.view);
  if (view === 'landing') {
    return (
      <section className={paneClass} aria-label="Home">
        <LandingView />
      </section>
    );
  }
  if (view !== 'chat') return <ViewPane view={view} />;
  return <FileEditor />;
}

function ViewPane({ view }: { view: Exclude<View, 'chat' | 'landing'> }) {
  return (
    <section className={paneClass} aria-label={VIEW_TITLES[view]}>
      <div className="flex h-9 shrink-0 items-end border-b border-border">
        <div className="flex h-full items-center gap-2 border-r border-border bg-bg px-3 text-xs">
          <span>{VIEW_TITLES[view]}</span>
          <button
            type="button"
            aria-label={`Close ${VIEW_TITLES[view]}`}
            onClick={() => useUiStore.getState().setView('chat')}
            className="rounded p-0.5 text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <X size={11} />
          </button>
        </div>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">
        <Suspense fallback={<ViewSkeleton label={view} />}>
          {view === 'usage' ? (
            <UsageView />
          ) : view === 'prompts' ? (
            <PromptsView />
          ) : (
            <SettingsView />
          )}
        </Suspense>
      </div>
    </section>
  );
}

function FileEditor() {
  const files = useActiveFiles();
  const newest = useNewestFileKey(files);
  const activeId = useConversations((s) => s.activeId);
  const thread = useConversations((s) => s.conversations.find((c) => c.id === s.activeId));
  const projectName = useProjects(
    (s) => s.projects.find((p) => p.id === thread?.projectId)?.name ?? null,
  );
  const activeKey = useIdeStore((s) => (activeId ? (s.activeFile[activeId] ?? null) : null));
  const closed = useIdeStore((s) => (activeId ? s.closedFiles[activeId] : undefined)) ?? NONE;

  // When a reply adds a version, show the file it changed (unless the user closed everything).
  const versionTotal = files.reduce((n, f) => n + f.versions.length, 0);
  const previous = useRef(versionTotal);
  useEffect(() => {
    if (activeId && newest && versionTotal > previous.current) {
      useIdeStore.getState().setActiveFile(activeId, newest);
    }
    previous.current = versionTotal;
  }, [versionTotal, newest, activeId]);

  const open = files.filter((f) => !closed.includes(f.key));
  const current =
    open.find((f) => f.key === (activeKey ?? newest)) ?? open[open.length - 1] ?? null;

  if (!current || !activeId) return <Welcome />;
  const version = current.versions[current.versions.length - 1];

  return (
    <section className={paneClass} aria-label="Editor">
      <div
        role="tablist"
        aria-label="Open files"
        className="flex h-9 shrink-0 items-end overflow-x-auto border-b border-border"
      >
        {open.map((f) => {
          const selected = f.key === current.key;
          return (
            <div
              key={f.key}
              className={cn(
                'group relative flex h-full shrink-0 items-center border-r border-border',
                selected ? 'bg-bg text-fg' : 'text-fg-muted hover:bg-hover',
              )}
            >
              {selected && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
              <button
                role="tab"
                type="button"
                aria-selected={selected}
                onClick={() => useIdeStore.getState().setActiveFile(activeId, f.key)}
                className="flex h-full max-w-48 items-center gap-1.5 pr-1 pl-3 text-xs"
              >
                <FileCode2 size={12} className="shrink-0 text-fg-subtle" />
                <span className="truncate">{f.name}</span>
                {f.versions.length > 1 && (
                  <span className="rounded bg-hover px-1 text-[10px] text-fg-subtle">
                    v{f.versions.length}
                  </span>
                )}
              </button>
              <button
                type="button"
                aria-label={`Close ${f.name}`}
                onClick={() => useIdeStore.getState().closeFile(activeId, f.key)}
                className="mr-1.5 rounded p-0.5 text-fg-subtle opacity-0 group-hover:opacity-100 hover:bg-hover hover:text-fg focus-visible:opacity-100"
              >
                <X size={11} />
              </button>
            </div>
          );
        })}
      </div>

      <nav
        aria-label="Breadcrumb"
        className="flex h-7 shrink-0 items-center gap-1 border-b border-border px-3 text-[11px] text-fg-subtle"
      >
        {projectName && (
          <>
            <span>{projectName}</span>
            <ChevronRight size={10} />
          </>
        )}
        <span className="max-w-48 truncate">{thread?.title ?? 'New thread'}</span>
        <ChevronRight size={10} />
        <span className="text-fg-muted">{current.name}</span>
        {version && (
          <span className="ml-auto tabular-nums">
            {current.language || 'text'} · {version.code.split('\n').length} lines
          </span>
        )}
      </nav>

      <div className="min-h-0 flex-1 bg-bg">
        <FileViewer key={`${activeId}-${current.key}`} file={current} compact />
      </div>
    </section>
  );
}

const SHORTCUT_ROWS: [string, string][] = [
  ['New thread', 'Mod+T'],
  ['Command palette', 'Mod+K'],
  ['Toggle sidebar', 'Mod+B'],
  ['Toggle assistant', 'Mod+Shift+A'],
  ['Toggle activity panel', 'Mod+J'],
  ['Lock', 'Mod+L'],
];

function Welcome() {
  const mac = isMacPlatform();
  const conversations = useConversations((s) => s.conversations);
  const recent = conversations.slice(0, 5);

  return (
    <section className={paneClass} aria-label="Welcome">
      <div className="grid min-h-0 flex-1 place-items-center overflow-auto p-8">
        <div className="w-full max-w-xl">
          <h1 className="font-mono text-2xl font-semibold tracking-tight">geeked</h1>
          <p className="mt-1 text-fg-muted">
            An editor for conversations with Claude. Code that comes back in a reply opens here as a
            file, with versions, diffs and a live preview. Talk to the assistant on the right.
          </p>

          <div className="mt-8 grid gap-8 sm:grid-cols-2">
            <div>
              <h2 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
                Recent
              </h2>
              {recent.length === 0 && <p className="text-xs text-fg-subtle">No threads yet.</p>}
              <ul className="flex flex-col">
                {recent.map((c) => (
                  <li key={c.id}>
                    <button
                      type="button"
                      onClick={() => conversationsStore.getState().select(c.id)}
                      className="flex w-full items-center justify-between gap-3 rounded-control px-2 py-1.5 text-left text-xs hover:bg-hover"
                    >
                      <span className="truncate">{c.title}</span>
                      <span className="shrink-0 text-[10px] text-fg-subtle">
                        {formatAgo(c.updatedAt)}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="mb-2 text-[10px] font-semibold tracking-wider text-fg-subtle uppercase">
                Keyboard
              </h2>
              <ul className="flex flex-col gap-1">
                {SHORTCUT_ROWS.map(([label, keys]) => (
                  <li key={label} className="flex items-center justify-between text-xs">
                    <span className="text-fg-muted">{label}</span>
                    <kbd className="rounded border border-border px-1.5 font-mono text-[10px] text-fg-subtle">
                      {formatKeys(keys, mac)}
                    </kbd>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
