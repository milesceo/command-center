import { createStore, useStore } from 'zustand';
import { getDb, type Db } from '../lib/db';
import * as repo from '../lib/repo-projects';
import type { Project } from '../lib/types';

export interface ProjectsState {
  projects: Project[];
  loaded: boolean;
  error: string | null;

  load: () => Promise<void>;
  create: (name: string) => Promise<Project | null>;
  rename: (id: string, name: string) => Promise<void>;
  setSystemPrompt: (
    id: string,
    promptId: string | null,
    vars: Record<string, string>,
  ) => Promise<void>;
  remove: (id: string) => Promise<void>;
}

export function createProjectsStore(database: () => Promise<Db> = getDb) {
  return createStore<ProjectsState>()((set) => {
    const refresh = async () =>
      set({ projects: await repo.listProjects(await database()), loaded: true, error: null });
    const guarded = async <T>(action: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await action();
      } catch (err) {
        set({ error: err instanceof Error ? err.message : String(err) });
        return fallback;
      }
    };

    return {
      projects: [],
      loaded: false,
      error: null,

      load: () => guarded(refresh, undefined),

      create: (name) =>
        guarded(async () => {
          if (!name.trim()) return null;
          const created = await repo.createProject(await database(), name);
          await refresh();
          return created;
        }, null),

      rename: (id, name) =>
        guarded(async () => {
          if (!name.trim()) return;
          await repo.renameProject(await database(), id, name);
          await refresh();
        }, undefined),

      setSystemPrompt: (id, promptId, vars) =>
        guarded(async () => {
          await repo.setProjectSystemPrompt(await database(), id, promptId, vars);
          await refresh();
        }, undefined),

      remove: (id) =>
        guarded(async () => {
          await repo.deleteProject(await database(), id);
          await refresh();
        }, undefined),
    };
  });
}

export const projectsStore = createProjectsStore();
export const useProjects = <T>(selector: (state: ProjectsState) => T): T =>
  useStore(projectsStore, selector);
