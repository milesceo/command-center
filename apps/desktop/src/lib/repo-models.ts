import {
  isAbsolutePath,
  isHfRepoId,
  isHttpUrl,
  isLocalModelName,
  isLocalRuntimeId,
  isQuantTag,
  parseChatParams,
  type ChatParams,
  type LocalRuntimeId,
} from '@command-center/protocol';
import type { Db } from './db';
import { normalizeTags } from './prompt-library';

/** A model the user added in the Model Lab. */
export interface CustomModel {
  id: string;
  provider: 'huggingface' | 'local';
  /** What the server is asked for: an HF repo id (with an optional suffix) or a local name. */
  model: string;
  displayName: string;
  hfRepo: string | null;
  runtime: LocalRuntimeId | null;
  baseUrl: string | null;
  quant: string | null;
  filePath: string | null;
  adapterPath: string | null;
  systemPrompt: string | null;
  params: ChatParams;
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type CustomModelInput = Omit<CustomModel, 'id' | 'createdAt' | 'updatedAt'>;

interface Row {
  id: string;
  provider: string;
  model: string;
  display_name: string;
  hf_repo: string | null;
  runtime: string | null;
  base_url: string | null;
  quant: string | null;
  file_path: string | null;
  adapter_path: string | null;
  system_prompt: string | null;
  params: string;
  tags: string;
  created_at: number;
  updated_at: number;
}

export class CustomModelError extends Error {}

/**
 * Checks a model before it is stored, with the same rules the bridge applies, so a bad record can
 * never be sent: the id must suit its provider, local models need a runtime and an http(s) base
 * URL, paths must be absolute, and parameters must be in range.
 */
export function validateCustomModel(input: CustomModelInput): CustomModelInput {
  const displayName = input.displayName.trim();
  if (!displayName || displayName.length > 80) {
    throw new CustomModelError('Give the model a name of 1 to 80 characters.');
  }
  if (input.provider === 'huggingface') {
    if (!isHfRepoId(input.model)) {
      throw new CustomModelError(
        'Use a Hugging Face model id like owner/name (optionally :provider).',
      );
    }
  } else if (input.provider === 'local') {
    if (!isLocalModelName(input.model)) {
      throw new CustomModelError('That local model name has characters the servers do not accept.');
    }
    if (!isLocalRuntimeId(input.runtime)) throw new CustomModelError('Choose a runtime.');
    if (!isHttpUrl(input.baseUrl))
      throw new CustomModelError('The server address must be an http(s) URL.');
  } else {
    throw new CustomModelError('Unknown provider.');
  }
  if (input.hfRepo !== null && !isHfRepoId(input.hfRepo)) {
    throw new CustomModelError('That Hugging Face repo id is not valid.');
  }
  if (input.quant !== null && !isQuantTag(input.quant)) {
    throw new CustomModelError('That quantisation tag is not valid.');
  }
  if (input.filePath !== null && !isAbsolutePath(input.filePath)) {
    throw new CustomModelError('The model file path must be absolute.');
  }
  if (input.adapterPath !== null) {
    if (input.runtime !== 'mlx')
      throw new CustomModelError('Adapters are supported for MLX-LM only.');
    if (!isAbsolutePath(input.adapterPath))
      throw new CustomModelError('The adapter path must be absolute.');
  }
  const params = parseChatParams(input.params);
  if (!params.ok) throw new CustomModelError(params.message);
  return {
    ...input,
    displayName,
    systemPrompt: input.systemPrompt?.trim() ? input.systemPrompt : null,
    params: params.value,
    tags: normalizeTags(input.tags),
  };
}

function parseJson<T>(text: string, fallback: T, check: (v: unknown) => v is T): T {
  try {
    const value: unknown = JSON.parse(text);
    return check(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

const isStringList = (v: unknown): v is string[] =>
  Array.isArray(v) && v.every((t) => typeof t === 'string');

function toModel(row: Row): CustomModel {
  // A corrupt params column falls back to no presets rather than hiding the model.
  const rawParams = parseJson<unknown>(row.params, {}, (_v): _v is unknown => true);
  const params = parseChatParams(rawParams);
  return {
    id: row.id,
    provider: row.provider === 'local' ? 'local' : 'huggingface',
    model: row.model,
    displayName: row.display_name,
    hfRepo: row.hf_repo,
    runtime: isLocalRuntimeId(row.runtime) ? row.runtime : null,
    baseUrl: row.base_url,
    quant: row.quant,
    filePath: row.file_path,
    adapterPath: row.adapter_path,
    systemPrompt: row.system_prompt,
    params: params.ok ? params.value : {},
    tags: parseJson(row.tags, [], isStringList),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listCustomModels(db: Db): Promise<CustomModel[]> {
  const rows = await db.select<Row>(
    'SELECT * FROM custom_models ORDER BY display_name COLLATE NOCASE, created_at',
  );
  return rows.map(toModel);
}

export async function getCustomModel(db: Db, id: string): Promise<CustomModel | null> {
  const rows = await db.select<Row>('SELECT * FROM custom_models WHERE id = ?', [id]);
  return rows[0] ? toModel(rows[0]) : null;
}

export async function createCustomModel(
  db: Db,
  input: CustomModelInput,
  now = Date.now(),
): Promise<CustomModel> {
  const clean = validateCustomModel(input);
  const model: CustomModel = { ...clean, id: crypto.randomUUID(), createdAt: now, updatedAt: now };
  await db.execute(
    `INSERT INTO custom_models (id, provider, model, display_name, hf_repo, runtime, base_url, quant,
       file_path, adapter_path, system_prompt, params, tags, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      model.id,
      model.provider,
      model.model,
      model.displayName,
      model.hfRepo,
      model.runtime,
      model.baseUrl,
      model.quant,
      model.filePath,
      model.adapterPath,
      model.systemPrompt,
      JSON.stringify(model.params),
      JSON.stringify(model.tags),
      model.createdAt,
      model.updatedAt,
    ],
  );
  return model;
}

export async function updateCustomModel(
  db: Db,
  id: string,
  input: CustomModelInput,
  now = Date.now(),
): Promise<CustomModel | null> {
  const clean = validateCustomModel(input);
  const { rowsAffected } = await db.execute(
    `UPDATE custom_models SET provider = ?, model = ?, display_name = ?, hf_repo = ?, runtime = ?,
       base_url = ?, quant = ?, file_path = ?, adapter_path = ?, system_prompt = ?, params = ?,
       tags = ?, updated_at = ? WHERE id = ?`,
    [
      clean.provider,
      clean.model,
      clean.displayName,
      clean.hfRepo,
      clean.runtime,
      clean.baseUrl,
      clean.quant,
      clean.filePath,
      clean.adapterPath,
      clean.systemPrompt,
      JSON.stringify(clean.params),
      JSON.stringify(clean.tags),
      now,
      id,
    ],
  );
  return rowsAffected > 0 ? getCustomModel(db, id) : null;
}

export async function deleteCustomModel(db: Db, id: string): Promise<void> {
  await db.execute('DELETE FROM custom_models WHERE id = ?', [id]);
}
