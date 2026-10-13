import {
  Check,
  ChevronDown,
  ChevronRight,
  FolderInput,
  FolderPlus,
  Pencil,
  Pin,
  PinOff,
  Plus,
  Search,
  Settings2,
  Trash2,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { ListSkeleton } from '../ui/skeleton';
import { cn } from '../../lib/cn';
import type { Conversation, Project } from '../../lib/types';
import { chatStore, useChat } from '../../stores/chat';
import { conversationsStore, useConversations } from '../../stores/conversations';
import { projectsStore, useProjects } from '../../stores/projects';
import { useUiStore } from '../../stores/ui';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';
import { ProjectDialog } from './ProjectDialog';

function MoveMenu({
  conversation,
  projects,
  onClose,
}: {
  conversation: Conversation;
  projects: Project[];
  onClose: () => void;
}) {
  const root = useRef<HTMLUListElement>(null);
  useEffect(() => {
    const onDown = (e: MouseEvent) => !root.current?.contains(e.target as Node) && onClose();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [onClose]);

  const move = (projectId: string | null) => {
    void conversationsStore.getState().moveToProject(conversation.id, projectId);
    onClose();
  };
  return (
    <ul
      ref={root}
      role="menu"
      aria-label="Move to project"
      className="absolute top-full right-1 z-20 mt-1 min-w-40 rounded-control border border-border-strong bg-elevated p-1 text-xs shadow-xl"
    >
      <li>
        <button
          role="menuitem"
          type="button"
          className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover"
          onClick={() => move(null)}
        >
          <span className="w-3">{conversation.projectId === null && <Check size={11} />}</span>No
          project
        </button>
      </li>
      {projects.map((p) => (
        <li key={p.id}>
          <button
            role="menuitem"
            type="button"
            className="flex w-full items-center gap-2 rounded px-2 py-1 text-left hover:bg-hover"
            onClick={() => move(p.id)}
          >
            <span className="w-3">{conversation.projectId === p.id && <Check size={11} />}</span>
            <span className="truncate">{p.name}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function Row({
  conversation,
  active,
  streaming,
  projects,
  onDelete,
}: {
  conversation: Conversation;
  active: boolean;
  streaming: boolean;
  projects: Project[];
  onDelete: (c: Conversation) => void;
}) {
  const [renaming, setRenaming] = useState(false);
  const [moving, setMoving] = useState(false);
  const [title, setTitle] = useState(conversation.title);
  const input = useRef<HTMLInputElement>(null);
  const { select, rename, togglePin } = conversationsStore.getState();

  useEffect(() => {
    if (renaming) input.current?.select();
  }, [renaming]);

  const commit = () => {
    setRenaming(false);
    if (title.trim() && title.trim() !== conversation.title) void rename(conversation.id, title);
    else setTitle(conversation.title);
  };

  if (renaming) {
    return (
      <li className="flex items-center gap-1 rounded-control bg-hover px-1.5 py-1">
        <input
          ref={input}
          value={title}
          aria-label="Conversation title"
          onChange={(e) => setTitle(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit();
            if (e.key === 'Escape') {
              setTitle(conversation.title);
              setRenaming(false);
            }
          }}
          className="min-w-0 flex-1 bg-transparent text-[13px] outline-none"
        />
        <Check size={13} className="text-fg-subtle" />
      </li>
    );
  }

  return (
    <li
      className={cn(
        'group relative flex items-center rounded-control pr-1 transition-colors',
        active ? 'bg-hover text-fg' : 'text-fg-muted hover:bg-hover hover:text-fg',
      )}
    >
      <button
        type="button"
        onClick={() => {
          select(conversation.id);
          useUiStore.getState().setView('chat');
        }}
        onDoubleClick={() => setRenaming(true)}
        aria-current={active ? 'true' : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
      >
        {conversation.pinned && <Pin size={11} className="shrink-0 text-fg-subtle" />}
        <span className="min-w-0 flex-1 truncate">{conversation.title}</span>
        {streaming && <span className="caret shrink-0" aria-label="Generating" />}
      </button>
      <span
        className={cn(
          'shrink-0 items-center group-focus-within:flex group-hover:flex',
          moving ? 'flex' : 'hidden',
        )}
      >
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label={conversation.pinned ? 'Unpin' : 'Pin'}
          title={conversation.pinned ? 'Unpin' : 'Pin'}
          onClick={() => void togglePin(conversation.id)}
        >
          {conversation.pinned ? <PinOff size={12} /> : <Pin size={12} />}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Move to project"
          aria-haspopup="menu"
          aria-expanded={moving}
          title="Move to project"
          onClick={() => setMoving((v) => !v)}
        >
          <FolderInput size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Rename"
          title="Rename"
          onClick={() => setRenaming(true)}
        >
          <Pencil size={12} />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="size-6"
          aria-label="Delete"
          title="Delete"
          onClick={() => onDelete(conversation)}
        >
          <Trash2 size={12} />
        </Button>
      </span>
      {moving && (
        <MoveMenu
          conversation={conversation}
          projects={projects}
          onClose={() => setMoving(false)}
        />
      )}
    </li>
  );
}

function NewProjectRow() {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const finish = async (create: boolean) => {
    const value = name.trim();
    setOpen(false);
    setName('');
    if (create && value) await projectsStore.getState().create(value);
  };
  if (!open) {
    return (
      <Button
        variant="ghost"
        size="sm"
        className="mx-3 mb-1 w-[calc(100%-1.5rem)] justify-start text-fg-muted"
        onClick={() => setOpen(true)}
      >
        <FolderPlus size={13} />
        New project
      </Button>
    );
  }
  return (
    <div className="mx-3 mb-1">
      <input
        autoFocus
        value={name}
        aria-label="Project name"
        placeholder="Project name"
        onChange={(e) => setName(e.target.value)}
        onBlur={() => void finish(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void finish(true);
          if (e.key === 'Escape') void finish(false);
        }}
        className="h-8 w-full rounded-control border border-border-strong bg-bg px-2 text-[13px] outline-none"
      />
    </div>
  );
}

export function ConversationList() {
  const { conversations, activeId, search, loaded, error } = useConversations((s) => s);
  const projects = useProjects((s) => s.projects);
  const streams = useChat((s) => s.streams);
  const [query, setQuery] = useState(search);
  const [pending, setPending] = useState<Conversation | null>(null);
  const [pendingProject, setPendingProject] = useState<Project | null>(null);
  const [editingProject, setEditingProject] = useState<Project | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  // Debounce so each keystroke doesn't hit SQLite.
  useEffect(() => {
    const t = setTimeout(() => void conversationsStore.getState().setSearch(query), 150);
    return () => clearTimeout(t);
  }, [query]);

  const searching = search.trim() !== '';
  const row = (c: Conversation) => (
    <Row
      key={c.id}
      conversation={c}
      active={c.id === activeId}
      streaming={streams[c.id] !== undefined}
      projects={projects}
      onDelete={setPending}
    />
  );
  const heading = (label: string) => (
    <h2 className="px-2 pt-2 pb-1 text-[11px] font-medium tracking-wide text-fg-subtle uppercase">
      {label}
    </h2>
  );

  const pinned = conversations.filter((c) => c.pinned);
  const unpinned = conversations.filter((c) => !c.pinned);
  const ungrouped = unpinned.filter(
    (c) => c.projectId === null || !projects.some((p) => p.id === c.projectId),
  );

  const startChatIn = (project: Project) => {
    conversationsStore.getState().newChat();
    void conversationsStore.getState().updateSettings({ projectId: project.id });
    useUiStore.getState().setView('chat');
  };

  return (
    <>
      <div className="px-3 pb-1">
        <div className="relative">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chats"
            aria-label="Search conversations"
            className="h-8 w-full rounded-control border border-border bg-bg pr-6 pl-7 text-[13px] outline-none placeholder:text-fg-subtle focus:border-border-strong"
          />
          {query && (
            <button
              type="button"
              aria-label="Clear search"
              className="absolute top-1/2 right-1.5 -translate-y-1/2 text-fg-subtle hover:text-fg"
              onClick={() => setQuery('')}
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>
      {!searching && <NewProjectRow />}

      <nav aria-label="Conversations" className="min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {!loaded && !error && <ListSkeleton />}
        {error && (
          <p role="alert" className="px-2 py-1 text-xs text-danger">
            Could not load chats: {error}
          </p>
        )}
        {!error && loaded && conversations.length === 0 && projects.length === 0 && (
          <p className="px-2 py-2 text-xs text-fg-subtle">
            {searching ? 'No chats match your search.' : 'No conversations yet.'}
          </p>
        )}

        {searching ? (
          conversations.length > 0 && (
            <section>
              {heading('Results')}
              <ul className="flex flex-col gap-px">{conversations.map(row)}</ul>
            </section>
          )
        ) : (
          <>
            {pinned.length > 0 && (
              <section>
                {heading('Pinned')}
                <ul className="flex flex-col gap-px">{pinned.map(row)}</ul>
              </section>
            )}

            {projects.map((project) => {
              const members = unpinned.filter((c) => c.projectId === project.id);
              const isCollapsed = collapsed.has(project.id);
              return (
                <section
                  key={project.id}
                  aria-label={`Project ${project.name}`}
                  data-testid="project"
                >
                  <div className="group flex items-center pt-2 pr-1 pb-1">
                    <button
                      type="button"
                      aria-expanded={!isCollapsed}
                      onClick={() =>
                        setCollapsed((cur) => {
                          const next = new Set(cur);
                          if (next.has(project.id)) next.delete(project.id);
                          else next.add(project.id);
                          return next;
                        })
                      }
                      className="flex min-w-0 flex-1 items-center gap-1 px-1 text-left text-[11px] font-medium tracking-wide text-fg-subtle uppercase hover:text-fg-muted"
                    >
                      {isCollapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
                      <span className="truncate">{project.name}</span>
                      <span className="font-normal normal-case">{members.length}</span>
                    </button>
                    <span className="hidden shrink-0 items-center group-focus-within:flex group-hover:flex">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={`New chat in ${project.name}`}
                        title="New chat in this project"
                        onClick={() => startChatIn(project)}
                      >
                        <Plus size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={`Settings for ${project.name}`}
                        title="Project settings"
                        onClick={() => setEditingProject(project)}
                      >
                        <Settings2 size={12} />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-6"
                        aria-label={`Delete ${project.name}`}
                        title="Delete project"
                        onClick={() => setPendingProject(project)}
                      >
                        <Trash2 size={12} />
                      </Button>
                    </span>
                  </div>
                  {!isCollapsed &&
                    (members.length > 0 ? (
                      <ul className="flex flex-col gap-px">{members.map(row)}</ul>
                    ) : (
                      <p className="px-2 pb-1 text-xs text-fg-subtle">No chats yet.</p>
                    ))}
                </section>
              );
            })}

            {ungrouped.length > 0 && (
              <section>
                {heading(projects.length > 0 ? 'Other chats' : 'Recent')}
                <ul className="flex flex-col gap-px">{ungrouped.map(row)}</ul>
              </section>
            )}
          </>
        )}
      </nav>

      <ConfirmDialog
        open={pending !== null}
        title="Delete this chat?"
        confirmLabel="Delete"
        destructive
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (pending) {
            chatStore.getState().stop(pending.id);
            void conversationsStore.getState().remove(pending.id);
          }
          setPending(null);
        }}
      >
        <p>“{pending?.title}” and all of its messages will be permanently deleted.</p>
      </ConfirmDialog>

      <ConfirmDialog
        open={pendingProject !== null}
        title="Delete this project?"
        confirmLabel="Delete project"
        destructive
        onCancel={() => setPendingProject(null)}
        onConfirm={() => {
          if (pendingProject) {
            const id = pendingProject.id;
            void projectsStore
              .getState()
              .remove(id)
              .then(() => conversationsStore.getState().load());
          }
          setPendingProject(null);
        }}
      >
        <p>
          “{pendingProject?.name}” will be removed. Its chats are kept and move to “Other chats”.
        </p>
      </ConfirmDialog>

      {editingProject && (
        <ProjectDialog project={editingProject} onClose={() => setEditingProject(null)} />
      )}
    </>
  );
}
