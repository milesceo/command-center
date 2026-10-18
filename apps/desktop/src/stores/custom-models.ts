import type { ChatParams } from '@command-center/protocol';
import { create } from 'zustand';
import { getDb } from '../lib/db';
import * as repo from '../lib/repo-models';
import type { CustomModel, CustomModelInput } from '../lib/repo-models';

/** A chat's model value that points at a Model Lab entry: `cm:<id>`. */
export const CUSTOM_PREFIX = 'cm:';
export const customModelRef = (id: string) => `${CUSTOM_PREFIX}${id}`;
export const customModelId = (value: string | null | undefined): string | null =>
  value?.startsWith(CUSTOM_PREFIX) ? value.slice(CUSTOM_PREFIX.length) : null;

interface CustomModelsState {
  models: CustomModel[];
  loaded: boolean;
  error: string | null;
  load: () => Promise<void>;
  add: (input: CustomModelInput) => Promise<CustomModel>;
  update: (id: string, input: CustomModelInput) => Promise<CustomModel | null>;
  remove: (id: string) => Promise<void>;
}

export const useCustomModels = create<CustomModelsState>()((set, get) => ({
  models: [],
  loaded: false,
  error: null,

  async load() {
    try {
      const models = await repo.listCustomModels(await getDb());
      set({ models, loaded: true, error: null });
    } catch (err) {
      set({ loaded: true, error: err instanceof Error ? err.message : String(err) });
    }
  },

  async add(input) {
    const model = await repo.createCustomModel(await getDb(), input);
    await get().load();
    return model;
  },

  async update(id, input) {
    const model = await repo.updateCustomModel(await getDb(), id, input);
    await get().load();
    return model;
  },

  async remove(id) {
    await repo.deleteCustomModel(await getDb(), id);
    await get().load();
  },
}));

/** What a chat request needs from a Model Lab entry. */
export interface ResolvedModel {
  model: string;
  params?: ChatParams;
  baseUrl?: string;
  systemPrompt?: string;
}

/**
 * Turns a chat's `cm:<id>` model into the request fields: the name the server knows, the
 * presets, the server address and the model's default system prompt. Null for any other model
 * value (the original providers are untouched).
 */
export async function resolveCustomModel(
  value: string | null | undefined,
  load: (id: string) => Promise<CustomModel | null> = async (id) =>
    repo.getCustomModel(await getDb(), id),
): Promise<ResolvedModel | null> {
  const id = customModelId(value);
  if (!id) return null;
  const m = await load(id);
  if (!m) return null;
  return {
    model: m.model,
    ...(Object.keys(m.params).length > 0 ? { params: m.params } : {}),
    ...(m.provider === 'local' && m.baseUrl ? { baseUrl: m.baseUrl } : {}),
    ...(m.systemPrompt ? { systemPrompt: m.systemPrompt } : {}),
  };
}
