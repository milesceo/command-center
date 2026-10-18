import {
  LOCAL_RUNTIME_INFO,
  runCommandLine,
  servedModelName,
  type LocalModelSource,
  type LocalRunRequest,
  type LocalRuntimeId,
} from '@command-center/protocol';
import type { CustomModel, CustomModelInput } from './repo-models';

/**
 * What the Add a model dialog has chosen so far, and the pure rules that turn it into a stored
 * model and the runtime command. Kept apart from the dialog so the rules are tested directly.
 */

/** What the model was picked from. */
export type DraftSource =
  | { kind: 'hub'; repo: string; format: 'gguf' | 'mlx' | 'other' }
  | { kind: 'file'; path: string; format: 'gguf' | 'mlx' };

/** Runtimes that can serve each format (MLX-LM runs MLX folders; the others run GGUF). */
export const RUNTIMES_FOR: Record<'gguf' | 'mlx', LocalRuntimeId[]> = {
  gguf: ['ollama', 'llama.cpp', 'lmstudio'],
  mlx: ['mlx', 'lmstudio'],
};

export function runtimesFor(source: DraftSource): LocalRuntimeId[] {
  return source.format === 'other' ? [] : RUNTIMES_FOR[source.format];
}

/** The repo id without a `:provider` suffix. */
export const baseRepo = (repo: string): string => repo.split(':')[0] as string;

/** The local source the runtime command is built from. */
export function localSource(source: DraftSource, quant: string | null): LocalModelSource {
  if (source.kind === 'file') return { kind: 'file', path: source.path };
  return { kind: 'hf', repo: baseRepo(source.repo), ...(quant ? { quant } : {}) };
}

/** The `local.run` request for a draft (without type and id). */
export function runRequest(
  runtime: LocalRuntimeId,
  source: LocalModelSource,
  adapterPath: string | null = null,
): Omit<LocalRunRequest, 'type' | 'id'> {
  return {
    runtime,
    source,
    ...(runtime === 'mlx' && adapterPath ? { adapterPath } : {}),
  };
}

/** The command line shown before it runs: the same builder the bridge uses, with the bare name. */
export function previewCommand(request: Omit<LocalRunRequest, 'type' | 'id'>): string {
  return runCommandLine(
    { ...request, type: 'local.run', id: 'preview' },
    LOCAL_RUNTIME_INFO[request.runtime].command,
  );
}

/** A starting display name: the repo's name (plus the quant) or the file's name. */
export function defaultName(source: DraftSource, quant: string | null): string {
  const raw =
    source.kind === 'hub'
      ? (baseRepo(source.repo).split('/')[1] ?? source.repo)
      : (source.path.split(/[\\/]/).filter(Boolean).pop() ?? 'Model');
  const name = raw.replace(/\.gguf$/i, '').replace(/-GGUF$/i, '');
  return (quant ? `${name} ${quant}` : name).slice(0, 80);
}

/** The model as it is stored, for the cloud route or a local runtime. */
export function draftToInput(
  source: DraftSource,
  choice:
    | { route: 'cloud' }
    | { route: 'local'; runtime: LocalRuntimeId; quant: string | null; adapterPath: string | null },
  displayName: string,
): CustomModelInput {
  const common = {
    displayName,
    systemPrompt: null,
    params: {},
    tags: [],
  };
  if (choice.route === 'cloud') {
    if (source.kind !== 'hub') throw new Error('Only Hugging Face models run in the cloud.');
    return {
      ...common,
      provider: 'huggingface',
      model: source.repo,
      hfRepo: baseRepo(source.repo),
      runtime: null,
      baseUrl: null,
      quant: null,
      filePath: null,
      adapterPath: null,
    };
  }
  const local = localSource(source, choice.quant);
  return {
    ...common,
    provider: 'local',
    model: servedModelName(choice.runtime, local),
    hfRepo: source.kind === 'hub' ? baseRepo(source.repo) : null,
    runtime: choice.runtime,
    baseUrl: LOCAL_RUNTIME_INFO[choice.runtime].baseUrl,
    quant: source.kind === 'hub' ? choice.quant : null,
    filePath: source.kind === 'file' ? source.path : null,
    adapterPath: choice.runtime === 'mlx' ? choice.adapterPath : null,
  };
}

/** The source a stored local model is served from, or null (cloud models, or nothing to run). */
export function storedSource(model: CustomModel): LocalModelSource | null {
  if (model.provider !== 'local') return null;
  if (model.filePath) return { kind: 'file', path: model.filePath };
  if (model.hfRepo) {
    return { kind: 'hf', repo: model.hfRepo, ...(model.quant ? { quant: model.quant } : {}) };
  }
  return null;
}

/** Whether a picked file is a GGUF file or an MLX folder, by its name. */
export const fileFormat = (path: string): 'gguf' | 'mlx' =>
  /\.gguf$/i.test(path) ? 'gguf' : 'mlx';
