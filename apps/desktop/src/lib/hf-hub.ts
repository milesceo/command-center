import { isHfRepoId, isQuantTag } from '@command-center/protocol';

/**
 * The public Hugging Face Hub API, read anonymously from the webview (CSP `connect-src` allows
 * https://huggingface.co; the Hub answers with CORS headers). Endpoints verified 2026-10-17:
 * `GET /api/models?search=&filter=&sort=downloads&direction=-1&limit=`, `GET /api/models/{id}`,
 * `GET /api/models/{id}/tree/main`. Every field is untrusted: values are validated and only
 * ever shown as text (React escapes them), never put in a URL other than the Hub's own, a shell
 * or HTML.
 */

export const HUB = 'https://huggingface.co';

export type HubFilter = 'any' | 'gguf' | 'mlx';

export interface HubModel {
  id: string;
  downloads: number;
  likes: number;
  pipelineTag: string | null;
  /** `false`, or how access is granted ('auto' | 'manual'). */
  gated: false | string;
  tags: string[];
}

export interface HubModelInfo extends HubModel {
  license: string | null;
  /** Total parameter count from the safetensors index, when published. */
  parameters: number | null;
  /** File names in the repo. */
  files: string[];
}

export interface HubFile {
  path: string;
  size: number;
}

export interface GgufChoice {
  file: string;
  /** The quant tag parsed from the name (`Q4_K_M`), used by `ollama run` and `llama-server -hf`. */
  quant: string | null;
  size: number;
}

type Fetch = typeof fetch;

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0);
const str = (v: unknown, max = 200): string | null =>
  typeof v === 'string' && v.length > 0 && v.length <= max ? v : null;

function toModel(raw: unknown): HubModel | null {
  if (!isObject(raw) || !isHfRepoId(raw.id)) return null;
  const gated =
    raw.gated === 'auto' || raw.gated === 'manual' || raw.gated === true
      ? String(raw.gated)
      : false;
  return {
    id: raw.id,
    downloads: num(raw.downloads),
    likes: num(raw.likes),
    pipelineTag: str(raw.pipeline_tag, 60),
    gated,
    tags: Array.isArray(raw.tags)
      ? raw.tags.filter((t): t is string => typeof t === 'string' && t.length <= 100).slice(0, 50)
      : [],
  };
}

async function getJson(fetchImpl: Fetch, path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetchImpl(`${HUB}${path}`, signal ? { signal } : {});
  if (response.status === 404) throw new HubError('That model was not found on Hugging Face.');
  if (response.status === 401 || response.status === 403) {
    throw new HubError('That model is private or gated; it cannot be read without access.');
  }
  if (!response.ok) throw new HubError(`Hugging Face answered HTTP ${response.status}.`);
  return response.json();
}

export class HubError extends Error {}

/** Text-generation models matching `query`, most downloaded first. */
export async function searchModels(
  query: string,
  filter: HubFilter,
  fetchImpl: Fetch = fetch,
  signal?: AbortSignal,
): Promise<HubModel[]> {
  const params = new URLSearchParams({
    search: query.trim().slice(0, 100),
    pipeline_tag: 'text-generation',
    sort: 'downloads',
    direction: '-1',
    limit: '30',
  });
  if (filter !== 'any') params.set('filter', filter);
  const raw = await getJson(fetchImpl, `/api/models?${params.toString()}`, signal);
  return Array.isArray(raw) ? raw.map(toModel).filter((m): m is HubModel => m !== null) : [];
}

/** One model's public details. */
export async function modelInfo(id: string, fetchImpl: Fetch = fetch): Promise<HubModelInfo> {
  if (!isHfRepoId(id)) throw new HubError('That is not a Hugging Face model id (owner/name).');
  const base = id.split(':')[0] as string;
  const raw = await getJson(fetchImpl, `/api/models/${base}`);
  const model = toModel(raw);
  if (!model || !isObject(raw)) throw new HubError('Hugging Face sent an unexpected answer.');
  const card = isObject(raw.cardData) ? raw.cardData : {};
  const safetensors = isObject(raw.safetensors) ? raw.safetensors : {};
  const siblings = Array.isArray(raw.siblings) ? raw.siblings : [];
  return {
    ...model,
    license: str(card.license, 80),
    parameters: num(safetensors.total) || null,
    files: siblings
      .map((s) => (isObject(s) ? str(s.rfilename, 300) : null))
      .filter((f): f is string => f !== null)
      .slice(0, 2000),
  };
}

/** Files at the top of the repo with their sizes (LFS size when stored there). */
export async function listFiles(id: string, fetchImpl: Fetch = fetch): Promise<HubFile[]> {
  if (!isHfRepoId(id)) throw new HubError('That is not a Hugging Face model id (owner/name).');
  const base = id.split(':')[0] as string;
  const raw = await getJson(fetchImpl, `/api/models/${base}/tree/main`);
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e): HubFile | null => {
      if (!isObject(e) || e.type === 'directory') return null;
      const path = str(e.path, 300);
      const lfs = isObject(e.lfs) ? num(e.lfs.size) : 0;
      return path ? { path, size: lfs || num(e.size) } : null;
    })
    .filter((f): f is HubFile => f !== null);
}

/** `qwen2.5-0.5b-instruct-q4_k_m.gguf` → `Q4_K_M`; split shards keep their quant. */
export function quantFromFile(file: string): string | null {
  const m = /[-._]((?:I?Q\d+(?:_[A-Z0-9]+)*)|F16|BF16|F32)(?:-\d+-of-\d+)?\.gguf$/i.exec(file);
  const tag = m?.[1]?.toUpperCase() ?? null;
  return tag && isQuantTag(tag) ? tag : null;
}

/** The GGUF files of a repo, one entry per quant (shards summed), smallest first. */
export function ggufChoices(files: HubFile[]): GgufChoice[] {
  const byQuant = new Map<string, GgufChoice>();
  for (const f of files) {
    if (!/\.gguf$/i.test(f.path) || /mmproj/i.test(f.path)) continue;
    const quant = quantFromFile(f.path);
    const key = quant ?? f.path;
    const prev = byQuant.get(key);
    byQuant.set(
      key,
      prev ? { ...prev, size: prev.size + f.size } : { file: f.path, quant, size: f.size },
    );
  }
  return [...byQuant.values()].sort((a, b) => a.size - b.size);
}

/** True for an MLX-format repo (mlx-community and friends). */
export const isMlxRepo = (m: Pick<HubModel, 'id' | 'tags'>): boolean =>
  m.tags.includes('mlx') || m.id.toLowerCase().startsWith('mlx-community/');

/** Accepts `owner/name`, `owner/name:provider` or a huggingface.co link; returns the id or null. */
export function parseModelReference(input: string): string | null {
  const text = input.trim();
  const link = /^https?:\/\/(?:www\.)?(?:huggingface\.co|hf\.co)\/([^/?#\s]+\/[^/?#\s]+)/i.exec(
    text,
  );
  const id = link ? link[1] : text.replace(/^hf\.co\//i, '');
  // Dataset and Space links share the shape but are not models.
  if (/^(datasets|spaces)\//i.test(id ?? '')) return null;
  return isHfRepoId(id) ? (id as string) : null;
}

export type Warning = { level: 'warn' | 'info'; text: string };

/**
 * What to tell the user before they add a model: not a chat model, gated without a token, or
 * (local) likely too big for this computer's memory. `memoryBytes` is total RAM (Apple Silicon
 * shares it with the GPU); a model needs roughly its file size plus room for the context.
 */
export function addWarnings(
  info: HubModelInfo,
  opts: {
    route: 'cloud' | 'local';
    hasToken: boolean;
    memoryBytes: number | null;
    sizeBytes?: number;
  },
): Warning[] {
  const out: Warning[] = [];
  const chatTags = ['conversational', 'text-generation'];
  if (
    info.pipelineTag &&
    info.pipelineTag !== 'text-generation' &&
    !info.tags.some((t) => chatTags.includes(t))
  ) {
    out.push({
      level: 'warn',
      text: `This is a "${info.pipelineTag}" model, not a chat model; it may not answer chats.`,
    });
  }
  if (info.gated && opts.route === 'cloud' && !opts.hasToken) {
    out.push({
      level: 'warn',
      text: 'This model is gated: request access on its Hugging Face page and add a token.',
    });
  } else if (info.gated && opts.route === 'local') {
    out.push({
      level: 'warn',
      text: 'This model is gated: accept its terms on Hugging Face before the runtime can download it.',
    });
  }
  if (opts.route === 'local' && opts.memoryBytes && opts.sizeBytes) {
    const ratio = opts.sizeBytes / opts.memoryBytes;
    if (ratio > 0.75) {
      out.push({
        level: 'warn',
        text: 'This file is larger than this computer can comfortably run; pick a smaller quant.',
      });
    } else if (ratio > 0.5) {
      out.push({
        level: 'info',
        text: "This will use most of this computer's memory; other apps may slow down while it runs.",
      });
    }
  }
  if (opts.route === 'cloud' && !opts.hasToken) {
    out.push({
      level: 'info',
      text: 'Add a Hugging Face access token in Settings > AI agents to chat with it.',
    });
  }
  return out;
}

/** "1.2 GB" style sizes. */
export function formatBytes(bytes: number): string {
  if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
  if (bytes >= 1e6) return `${Math.round(bytes / 1e6)} MB`;
  return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
}
