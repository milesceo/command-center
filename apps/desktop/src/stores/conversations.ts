import { createStore, useStore } from 'zustand';
import { useShallow } from 'zustand/react/shallow';
import { getDb, type Db } from '../lib/db';
import * as repo from '../lib/repo';
import {
  DEFAULT_SETTINGS,
  DEFAULT_TITLE,
  type Conversation,
  type ConversationSettings,
} from '../lib/types';

export interface ConversationsState {
  conversations: Conversation[];
  search: string;
  /** Null means the "new chat" draft: no row exists until the first message is sent. */
  activeId: string | null;
  /** Settings applied to the draft, then copied into the conversation on creation. */
  draft: ConversationSettings;
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  setSearch: (query: string) => Promise<void>;
  newChat: () => void;
  select: (id: string) => void;
  /** Returns the active conversation, creating it from the draft on first use. */
  ensureActive: () => Promise<Conversation>;
  rename: (id: string, title: string) => Promise<void>;
  /** Names a conversation after its first message, but never overwrites a user-chosen title. */
  autoTitle: (id: string, title: string) => Promise<void>;
  togglePin: (id: string) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** Settings for the active conversation, or for the draft when there is none. */
  updateSettings: (patch: Partial<ConversationSettings>) => Promise<void>;
  /** Puts a conversation in a project (or takes it out with null). */
  moveToProject: (id: string, projectId: string | null) => Promise<void>;
  /** Moves a conversation to the top of its group after new activity. */
  touch: (id: string) => Promise<void>;
}

const MAX_TITLE = 60;

/** The settings part of a stored conversation. */
export function settingsOf(c: Conversation): ConversationSettings {
  return {
    model: c.model,
    systemPrompt: c.systemPrompt,
    systemPromptId: c.systemPromptId,
    systemPromptVars: c.systemPromptVars,
    toolsMode: c.toolsMode,
    cwd: c.cwd,
    projectId: c.projectId,
  };
}

/** First non-empty line of a message, trimmed to a sidebar-friendly length. */
export function titleFrom(text: string): string {
  const line =
    text
      .split('\n')
      .find((l) => l.trim().length > 0)
      ?.trim() ?? '';
  if (!line) return DEFAULT_TITLE;
  return line.length > MAX_TITLE ? `${line.slice(0, MAX_TITLE - 1)}…` : line;
}

const message = (err: unknown) => (err instanceof Error ? err.message : String(err));

/** Factory so tests can inject an in-memory database. */
export function createConversationsStore(database: () => Promise<Db> = getDb) {
  return createStore<ConversationsState>()((set, get) => {
    const refresh = async () => {
      const db = await database();
      const search = get().search;
      const conversations = await repo.listConversations(db, search);
      // A slow earlier query must not overwrite the results of a newer search.
      if (get().search === search) set({ conversations, loaded: true, error: null });
    };
    const guarded = async (action: () => Promise<void>) => {
      try {
        await action();
      } catch (err) {
        set({ error: message(err) });
      }
    };

    return {
      conversations: [],
      search: '',
      activeId: null,
      draft: DEFAULT_SETTINGS,
      loaded: false,
      error: null,

      load: () => guarded(refresh),

      setSearch: async (query) => {
        set({ search: query });
        await guarded(refresh);
      },

      newChat: () => set({ activeId: null, draft: DEFAULT_SETTINGS }),

      select: (id) => set({ activeId: id }),

      ensureActive: async () => {
        const { activeId, draft } = get();
        const db = await database();
        if (activeId) {
          const existing = await repo.getConversation(db, activeId);
          if (existing) return existing;
        }
        const created = await repo.createConversation(db, draft);
        set({ activeId: created.id });
        await guarded(refresh);
        return created;
      },

      rename: (id, title) =>
        guarded(async () => {
          const trimmed = title.trim();
          if (!trimmed) return;
          await repo.renameConversation(await database(), id, trimmed);
          await refresh();
        }),

      autoTitle: (id, title) =>
        guarded(async () => {
          const db = await database();
          const current = await repo.getConversation(db, id);
          if (current?.title !== DEFAULT_TITLE) return;
          await repo.renameConversation(db, id, title);
          await refresh();
        }),

      togglePin: (id) =>
        guarded(async () => {
          const db = await database();
          const current = await repo.getConversation(db, id);
          if (!current) return;
          await repo.setPinned(db, id, !current.pinned);
          await refresh();
        }),

      remove: (id) =>
        guarded(async () => {
          await repo.deleteConversation(await database(), id);
          if (get().activeId === id) set({ activeId: null, draft: DEFAULT_SETTINGS });
          await refresh();
        }),

      updateSettings: (patch) =>
        guarded(async () => {
          const { activeId, draft } = get();
          if (!activeId) {
            set({ draft: { ...draft, ...patch } });
            return;
          }
          const db = await database();
          const current = await repo.getConversation(db, activeId);
          if (!current) return;
          await repo.updateSettings(db, activeId, { ...settingsOf(current), ...patch });
          await refresh();
        }),

      moveToProject: (id, projectId) =>
        guarded(async () => {
          const db = await database();
          const current = await repo.getConversation(db, id);
          if (!current) return;
          await repo.updateSettings(db, id, { ...settingsOf(current), projectId });
          await refresh();
        }),

      touch: (id) =>
        guarded(async () => {
          await repo.touchConversation(await database(), id);
          await refresh();
        }),
    };
  });
}

export const conversationsStore = createConversationsStore();

export function useConversations<T>(selector: (state: ConversationsState) => T): T {
  return useStore(conversationsStore, selector);
}

/** The settings in effect for the current view: the active conversation's, else the draft. */
export function selectActiveSettings(state: ConversationsState): ConversationSettings {
  const active = state.conversations.find((c) => c.id === state.activeId);
  return active ? settingsOf(active) : state.draft;
}

/**
 * Hook form of selectActiveSettings. The selector builds a new object each time,
 * which zustand v5 treats as a changed snapshot (infinite render loop) unless it
 * is compared shallowly.
 */
export function useActiveSettings(): ConversationSettings {
  return useStore(conversationsStore, useShallow(selectActiveSettings));
}
