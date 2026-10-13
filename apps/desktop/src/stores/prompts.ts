import { createStore, useStore } from 'zustand';
import { getDb, type Db } from '../lib/db';
import { LibraryFileError, buildLibraryFile, parseLibraryFile } from '../lib/prompt-library';
import * as repo from '../lib/repo-prompts';
import type { Prompt } from '../lib/types';

export interface PromptsState {
  prompts: Prompt[];
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (input: repo.PromptInput) => Promise<Prompt | null>;
  update: (id: string, input: repo.PromptInput) => Promise<void>;
  remove: (id: string) => Promise<void>;
  /** The library as the JSON text of an export file. */
  exportJson: () => string;
  /** Merges an export file; throws LibraryFileError with a readable reason for anything unexpected. */
  importJson: (text: string) => Promise<repo.ImportResult>;
}

export function createPromptsStore(database: () => Promise<Db> = getDb) {
  return createStore<PromptsState>()((set, get) => {
    const refresh = async () =>
      set({ prompts: await repo.listPrompts(await database()), loaded: true, error: null });
    const guarded = async <T>(action: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return fallback;
      }
    };

    return {
      prompts: [],
      loaded: false,
      error: null,

      load: () => guarded(refresh, undefined),

      create: (input) =>
        guarded(async () => {
          const created = await repo.createPrompt(await database(), input);
          await refresh();
          return created;
        }, null),

      update: (id, input) =>
        guarded(async () => {
          await repo.updatePrompt(await database(), id, input);
          await refresh();
        }, undefined),

      remove: (id) =>
        guarded(async () => {
          await repo.deletePrompt(await database(), id);
          await refresh();
        }, undefined),

      exportJson: () => JSON.stringify(buildLibraryFile(get().prompts), null, 2),

      async importJson(text) {
        const incoming = parseLibraryFile(text); // throws LibraryFileError before anything is written
        const result = await repo.importPrompts(await database(), incoming);
        await refresh();
        return result;
      },
    };
  });
}

export const promptsStore = createPromptsStore();
export const usePrompts = <T>(selector: (state: PromptsState) => T): T =>
  useStore(promptsStore, selector);
export { LibraryFileError };
