import { ChevronRight, FileCode2, FolderPlus, Plus, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { cn } from '../lib/cn';
import { formatAgo } from '../lib/format';
import { useChat } from '../stores/chat';
import { conversationsStore, useConversations } from '../stores/conversations';
import { useIdeStore } from '../stores/ide';
import { projectsStore } from '../stores/projects';
import { useUiStore } from '../stores/ui';
import { useActiveFiles, useNewestFileKey, useThreadGroups } from './shared/hooks';
import { projectColor } from './shared/threads';

function SectionHeader({
  id,
  label,
  count,
  children,
}: {
  id: string;
  label: string;
  count?: number;
  children?: React.ReactNode;
}) {
  const collapsed = useIdeStore((s) => s.collapsedSections[id] ?? false);
  return (
    <div className="flex h-7 items-center gap-1 px-2">
      <button
        type="button"
        aria-expanded={!collapsed}
        onClick={() => useIdeStore.getState().toggleSection(id)}
        className="flex min-w-0 flex-1 items-center gap-1 text-left text-[10px] font-semibold tracking-wider text-fg-subtle uppercase hover:text-fg-muted"
      >
        <ChevronRight size={11} className={cn('transition-transform', !collapsed && 'rotate-90')} />
        <span className="truncate">{label}</span>
        {count !== undefined && <span className="font-normal">{count}</span>}
      </button>
      {children}
    </div>
  );
}

/** Sidebar: threads grouped by project (like a project tree) and the files of the open thread. */
export function Explorer() {
  const groups = useThreadGroups();
  const activeId = useConversations((s) => s.activeId);
  const files = useActiveFiles();
  const newest = useNewestFileKey(files);
  const streams = useChat((s) => s.streams);
  const collapsedProjects = useIdeStore((s) => s.collapsedProjects);
  const collapsedSections = useIdeStore((s) => s.collapsedSections);
  const activeFile = useIdeStore((s) => (activeId ? s.activeFile[activeId] : null));

  const [filter, setFilter] = useState('');
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');

  const q = filter.trim().toLowerCase();
  const visible = useMemo(
    () =>
      groups
        .map((g) => ({
          ...g,
          conversations: q
            ? g.conversations.filter((c) => c.title.toLowerCase().includes(q))
            : g.conversations,
        }))
        .filter((g) => g.conversations.length > 0 || (!q && g.project !== null)),
    [groups, q],
  );

  const openThread = (id: string) => {
    conversationsStore.getState().select(id);
    useUiStore.getState().setView('chat');
  };

  const createProject = async () => {
    const trimmed = name.trim();
    setNaming(false);
    setName('');
    if (trimmed) await projectsStore.getState().create(trimmed);
  };

  return (
    <aside
      aria-label="Explorer"
      className="flex w-64 shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-surface/80 backdrop-blur-xl"
    >
      <div className="flex items-center gap-1.5 px-2 pt-2 pb-1.5">
        <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-control border border-border bg-bg px-2 text-xs focus-within:border-accent">
          <Search size={12} className="shrink-0 text-fg-subtle" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter threads"
            aria-label="Filter threads"
            className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-fg-subtle"
          />
        </label>
        <button
          type="button"
          aria-label="New thread"
          title="New thread (Ctrl+T)"
          onClick={() => {
            conversationsStore.getState().newChat();
            useUiStore.getState().setView('chat');
          }}
          className="grid size-7 place-items-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
        >
          <Plus size={14} />
        </button>
      </div>

      <div className="min-h-0 flex-1 overflow-auto pb-2">
        <SectionHeader
          id="threads"
          label="Threads"
          count={groups.reduce((n, g) => n + g.conversations.length, 0)}
        >
          <button
            type="button"
            aria-label="New project"
            title="New project"
            onClick={() => setNaming(true)}
            className="grid size-5 place-items-center rounded text-fg-subtle hover:bg-hover hover:text-fg"
          >
            <FolderPlus size={12} />
          </button>
        </SectionHeader>

        {!collapsedSections['threads'] && (
          <div className="px-1.5">
            {naming && (
              <input
                autoFocus
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => void createProject()}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void createProject();
                  if (e.key === 'Escape') {
                    setNaming(false);
                    setName('');
                  }
                }}
                placeholder="Project name"
                aria-label="Project name"
                className="mb-1 h-7 w-full rounded-control border border-accent bg-bg px-2 text-xs outline-none"
              />
            )}
            {visible.length === 0 && (
              <p className="px-2 py-2 text-xs text-fg-subtle">
                {q ? 'No matching threads.' : 'No threads yet. Press Ctrl+T.'}
              </p>
            )}
            {visible.map((g) => {
              const id = g.project?.id ?? 'loose';
              const collapsed = !q && (collapsedProjects[id] ?? false);
              return (
                <div key={id} className="mb-0.5">
                  {g.project && (
                    <button
                      type="button"
                      aria-expanded={!collapsed}
                      onClick={() => useIdeStore.getState().toggleProject(id)}
                      className="flex h-(--row-h) w-full items-center gap-1.5 rounded-control px-1.5 text-left text-xs font-medium hover:bg-hover"
                    >
                      <ChevronRight
                        size={11}
                        className={cn(
                          'shrink-0 text-fg-subtle transition-transform',
                          !collapsed && 'rotate-90',
                        )}
                      />
                      <span
                        className="size-2 shrink-0 rounded-sm"
                        style={{ background: projectColor(g.project.id) }}
                      />
                      <span className="truncate">{g.project.name}</span>
                    </button>
                  )}
                  {!collapsed &&
                    g.conversations.map((c) => (
                      <button
                        key={c.id}
                        type="button"
                        onClick={() => openThread(c.id)}
                        aria-current={c.id === activeId ? 'true' : undefined}
                        title={c.title}
                        className={cn(
                          'group flex h-(--row-h) w-full items-center gap-2 rounded-control pr-2 text-left text-xs',
                          g.project ? 'pl-6' : 'pl-2',
                          c.id === activeId
                            ? 'bg-accent/15 text-fg'
                            : 'text-fg-muted hover:bg-hover hover:text-fg',
                        )}
                      >
                        <span
                          className={cn(
                            'size-1.5 shrink-0 rounded-full',
                            streams[c.id] ? 'animate-pulse bg-accent' : 'bg-border-strong',
                          )}
                        />
                        <span className="min-w-0 flex-1 truncate">{c.title}</span>
                        <span className="hidden shrink-0 text-[10px] text-fg-subtle group-hover:inline">
                          {formatAgo(c.updatedAt)}
                        </span>
                      </button>
                    ))}
                </div>
              );
            })}
          </div>
        )}

        <div className="mt-2 border-t border-border pt-1">
          <SectionHeader id="files" label="Files in thread" count={files.length} />
          {!collapsedSections['files'] && (
            <div className="px-1.5">
              {files.length === 0 && (
                <p className="px-2 py-1 text-xs text-fg-subtle">
                  Code Claude writes appears here as files with versions.
                </p>
              )}
              {files.map((f) => {
                const selected = (activeFile ?? newest) === f.key;
                return (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => {
                      if (activeId) useIdeStore.getState().setActiveFile(activeId, f.key);
                      useUiStore.getState().setView('chat');
                    }}
                    aria-current={selected ? 'true' : undefined}
                    className={cn(
                      'flex h-(--row-h) w-full items-center gap-2 rounded-control px-2 text-left text-xs',
                      selected
                        ? 'bg-accent/15 text-fg'
                        : 'text-fg-muted hover:bg-hover hover:text-fg',
                    )}
                  >
                    <FileCode2 size={13} className="shrink-0 text-fg-subtle" />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    {f.versions.length > 1 && (
                      <span className="shrink-0 rounded bg-hover px-1 text-[10px] text-fg-subtle tabular-nums">
                        v{f.versions.length}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </aside>
  );
}
