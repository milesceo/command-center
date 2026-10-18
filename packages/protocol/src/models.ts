/**
 * Custom models (Phase C): Hugging Face Inference Providers in the cloud, and models served on
 * this computer by Ollama, llama.cpp, MLX-LM or LM Studio. Every value here can come from the
 * network or from the user, so each has a strict validator; nothing that fails them may reach a
 * shell, a URL or HTML.
 */

export const LOCAL_RUNTIMES = ['ollama', 'llama.cpp', 'mlx', 'lmstudio'] as const;
export type LocalRuntimeId = (typeof LOCAL_RUNTIMES)[number];

export interface LocalRuntimeInfo {
  label: string;
  /** OpenAI-compatible base URL the runtime serves by default (the app may override it). */
  baseUrl: string;
  /** The program that shows the runtime is installed. */
  command: string;
}

/**
 * Defaults from each runtime's documentation (see docs/providers.md). MLX-LM and llama-server
 * both default to port 8080; Command Center starts MLX-LM on 8081 so both can run at once.
 */
export const LOCAL_RUNTIME_INFO: Readonly<Record<LocalRuntimeId, LocalRuntimeInfo>> = {
  ollama: { label: 'Ollama', baseUrl: 'http://127.0.0.1:11434/v1', command: 'ollama' },
  'llama.cpp': { label: 'llama.cpp', baseUrl: 'http://127.0.0.1:8080/v1', command: 'llama-server' },
  mlx: { label: 'MLX-LM', baseUrl: 'http://127.0.0.1:8081/v1', command: 'mlx_lm.server' },
  lmstudio: { label: 'LM Studio', baseUrl: 'http://127.0.0.1:1234/v1', command: 'lms' },
};

export const isLocalRuntimeId = (v: unknown): v is LocalRuntimeId =>
  typeof v === 'string' && (LOCAL_RUNTIMES as readonly string[]).includes(v);

const NAME_PART = '[A-Za-z0-9][A-Za-z0-9._-]{0,95}';
const HF_REPO = new RegExp(`^${NAME_PART}/${NAME_PART}(?::[a-z0-9][a-z0-9-]{0,39})?$`);

/**
 * A Hugging Face repo id, `owner/name`, optionally with an Inference Providers suffix
 * (`:provider-name`, or a policy such as `:fastest`).
 */
export const isHfRepoId = (v: unknown): v is string =>
  typeof v === 'string' && HF_REPO.test(v) && !v.includes('..');

/** A model name a local runtime reports or accepts (Ollama tags, MLX repos, GGUF file names). */
export const isLocalModelName = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:/@+-]{0,199}$/.test(v);

/** A GGUF quantisation tag (`Q4_K_M`, `IQ3_XS`, `f16`). */
export const isQuantTag = (v: unknown): v is string =>
  typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_.-]{0,39}$/.test(v);

/** An absolute POSIX or Windows path on one line, without control characters. */
export const isAbsolutePath = (v: unknown): v is string =>
  typeof v === 'string' &&
  v.length <= 1024 &&
  // eslint-disable-next-line no-control-regex -- control characters are exactly what is refused
  !/[\u0000-\u001f\u007f]/.test(v) &&
  (v.startsWith('/') || /^[A-Za-z]:[\\/]/.test(v));

/**
 * The scheme and host of an http(s) URL, or null. A small strict parser (this package compiles
 * without DOM or Node types, so `URL` is not available): `scheme://host[:port][/path]`, with no
 * credentials, no whitespace and a numeric port.
 */
function httpParts(v: unknown): { host: string } | null {
  if (typeof v !== 'string' || v.length > 2048 || /\s/.test(v)) return null;
  const m = /^(https?):\/\/([^/?#]*)([/?#].*)?$/i.exec(v);
  if (!m) return null;
  const authority = m[2] ?? '';
  if (authority === '' || authority.includes('@')) return null;
  const hp = /^(\[[0-9a-fA-F:.]+\]|[A-Za-z0-9.-]+)(?::(\d{1,5}))?$/.exec(authority);
  if (!hp) return null;
  if (hp[2] !== undefined && Number(hp[2]) > 65535) return null;
  return { host: (hp[1] ?? '').toLowerCase() };
}

/** True for an http(s) URL whose host is this computer (127.0.0.0/8, ::1, localhost). */
export function isLoopbackUrl(v: unknown): boolean {
  const parts = httpParts(v);
  if (!parts) return false;
  const host = parts.host.replace(/^\[|\]$/g, '');
  return host === 'localhost' || host === '::1' || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host);
}

/** An http(s) URL without credentials (a remote server the user explicitly allowed). */
export function isHttpUrl(v: unknown): boolean {
  return httpParts(v) !== null;
}

// ------------------------------------------------------------- parameters

/** Sampling and length settings a custom model may carry (all optional). */
export interface ChatParams {
  temperature?: number;
  topP?: number;
  topK?: number;
  maxTokens?: number;
  /** Context window to request (Ollama `num_ctx`); servers that fix it at start ignore it. */
  contextLength?: number;
  stop?: string[];
  repetitionPenalty?: number;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const RANGES = {
  temperature: { min: 0, max: 2, integer: false },
  topP: { min: 0, max: 1, integer: false },
  topK: { min: 1, max: 1000, integer: true },
  maxTokens: { min: 1, max: 2_000_000, integer: true },
  contextLength: { min: 256, max: 2_000_000, integer: true },
  repetitionPenalty: { min: 0.5, max: 2, integer: false },
} as const;

const isJson = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

/** Validates a `params` object field by field; anything unexpected is refused, not dropped. */
export function parseChatParams(raw: unknown): Result<ChatParams> {
  if (!isJson(raw)) return { ok: false, message: '`params` must be an object.' };
  const out: ChatParams = {};
  for (const [key, value] of Object.entries(raw)) {
    if (key === 'stop') {
      if (
        !Array.isArray(value) ||
        value.length > 8 ||
        !value.every((s) => typeof s === 'string' && s.length > 0 && s.length <= 64)
      ) {
        return {
          ok: false,
          message: '`params.stop` must be up to 8 strings of 1 to 64 characters.',
        };
      }
      out.stop = value as string[];
      continue;
    }
    const range = RANGES[key as keyof typeof RANGES];
    if (!range) return { ok: false, message: `Unknown parameter \`${key}\`.` };
    if (
      typeof value !== 'number' ||
      !Number.isFinite(value) ||
      value < range.min ||
      value > range.max ||
      (range.integer && !Number.isInteger(value))
    ) {
      return {
        ok: false,
        message: `\`params.${key}\` must be ${range.integer ? 'a whole number' : 'a number'} from ${range.min} to ${range.max}.`,
      };
    }
    (out as Record<string, number>)[key] = value;
  }
  return { ok: true, value: out };
}

// ------------------------------------------------------------- local.run

/** Where a local model comes from: a Hugging Face repo (and quant), or a file on this computer. */
export type LocalModelSource =
  { kind: 'hf'; repo: string; quant?: string } | { kind: 'file'; path: string };

/**
 * Opens a terminal running the runtime's own command to download (if needed) and serve a model.
 * The bridge builds the command from these validated parts; the terminal shows it and runs it
 * when the user presses Enter. Command Center never downloads or runs weights itself.
 */
export interface LocalRunRequest {
  type: 'local.run';
  id: string;
  runtime: LocalRuntimeId;
  source: LocalModelSource;
  /** MLX-LM only: a LoRA adapter folder (`--adapter-path`). */
  adapterPath?: string;
}

export function parseLocalRunRequest(
  id: string,
  v: Record<string, unknown>,
): Result<LocalRunRequest> {
  if (!isLocalRuntimeId(v.runtime)) return { ok: false, message: 'Unknown local runtime.' };
  const s = v.source;
  let source: LocalModelSource;
  if (isJson(s) && s.kind === 'hf' && isHfRepoId(s.repo) && !String(s.repo).includes(':')) {
    if (s.quant !== undefined && !isQuantTag(s.quant)) {
      return { ok: false, message: 'Invalid quantisation tag.' };
    }
    source = {
      kind: 'hf',
      repo: s.repo,
      ...(s.quant !== undefined ? { quant: s.quant as string } : {}),
    };
  } else if (isJson(s) && s.kind === 'file' && isAbsolutePath(s.path)) {
    source = { kind: 'file', path: s.path };
  } else {
    return {
      ok: false,
      message: 'A local model needs a Hugging Face repo id or an absolute file path.',
    };
  }
  const request: LocalRunRequest = { type: 'local.run', id, runtime: v.runtime, source };
  if (v.adapterPath !== undefined) {
    if (v.runtime !== 'mlx')
      return { ok: false, message: 'Adapters are supported for MLX-LM only.' };
    if (!isAbsolutePath(v.adapterPath))
      return { ok: false, message: 'The adapter path must be absolute.' };
    request.adapterPath = v.adapterPath;
  }
  return { ok: true, value: request };
}

// ------------------------------------------------------------- runtime status

/** What the `local` provider found for one runtime (part of its providers report entry). */
export interface RuntimeStatus {
  id: LocalRuntimeId;
  /** The runtime's program is on this computer. */
  installed: boolean;
  /** Its server answered at `baseUrl`. */
  running: boolean;
  baseUrl: string;
  /** Models the server lists (`GET /v1/models`); empty when not running. */
  models: string[];
}

/** Validates the `runtimes` list of a providers report; malformed entries are dropped. */
export function parseRuntimeStatuses(raw: unknown): RuntimeStatus[] | undefined {
  if (raw === undefined) return undefined;
  if (!Array.isArray(raw)) return [];
  const out: RuntimeStatus[] = [];
  for (const item of raw) {
    if (
      !isJson(item) ||
      !isLocalRuntimeId(item.id) ||
      typeof item.installed !== 'boolean' ||
      typeof item.running !== 'boolean' ||
      !isHttpUrl(item.baseUrl) ||
      !Array.isArray(item.models)
    ) {
      continue;
    }
    out.push({
      id: item.id,
      installed: item.installed,
      running: item.running,
      baseUrl: item.baseUrl as string,
      models: item.models.filter(isLocalModelName).slice(0, 200),
    });
  }
  return out;
}

/** POSIX single-quoting: safe for any characters, including quotes, spaces and unicode. */
export const shellQuote = (arg: string): string =>
  /^[A-Za-z0-9_./:@%+=,-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`;

/** Port Command Center passes to llama-server (its default differs between releases). */
export const LLAMA_PORT = 8080;
/** Port Command Center passes to mlx_lm.server, so it never clashes with llama-server. */
export const MLX_PORT = 8081;

/** A friendly, safe model name from a file name (`My Model.Q4_K_M.gguf` → `my-model-q4_k_m`). */
export function nameFromFile(path: string): string {
  const base = path.split(/[\\/]/).pop() ?? 'model';
  const stem = base.replace(/\.gguf$/i, '');
  const name = stem
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/-{2,}/g, '-')
    .replace(/^[^a-z0-9]+|-+$/g, '');
  return (name || 'model').slice(0, 64);
}

/**
 * The shell command line that downloads (if needed) and serves the model, each part quoted. The
 * program is the runtime's absolute path as found on this computer.
 */
export function runCommandLine(request: LocalRunRequest, program: string): string {
  const q = (parts: string[]) => parts.map(shellQuote).join(' ');
  const { source } = request;
  const hfRef =
    source.kind === 'hf' ? `${source.repo}${source.quant ? `:${source.quant}` : ''}` : '';
  switch (request.runtime) {
    case 'ollama':
      if (source.kind === 'hf') return q([program, 'run', `hf.co/${hfRef}`]);
      {
        // A local GGUF needs a one-line Modelfile; it is written next to nothing else of the
        // user's: a fresh temporary folder.
        const name = nameFromFile(source.path);
        const dir = `$(mktemp -d)`;
        const script = `d=${dir} && printf 'FROM %s\\n' ${shellQuote(source.path)} > "$d/Modelfile" && ${q([program, 'create', name, '-f'])} "$d/Modelfile" && ${q([program, 'run', name])}`;
        // Run by /bin/sh so it works whatever the user's login shell is (fish has no `d=...`).
        return q(['/bin/sh', '-c', script]);
      }
    case 'llama.cpp':
      return source.kind === 'hf'
        ? q([program, '-hf', hfRef, '--port', String(LLAMA_PORT)])
        : q([
            program,
            '-m',
            source.path,
            '--alias',
            nameFromFile(source.path),
            '--port',
            String(LLAMA_PORT),
          ]);
    case 'mlx': {
      const model = source.kind === 'hf' ? source.repo : source.path;
      const parts = [program, '--model', model, '--port', String(MLX_PORT)];
      if (request.adapterPath) parts.push('--adapter-path', request.adapterPath);
      return q(parts);
    }
    case 'lmstudio': {
      const model = source.kind === 'hf' ? source.repo : source.path;
      return `${q([program, source.kind === 'hf' ? 'get' : 'import', model])} && ${q([program, 'server', 'start'])}`;
    }
  }
}

/**
 * The model name a chat sends once the runtime serves `source` (what its `/v1/models` lists).
 * Ollama names pulled models `hf.co/owner/name[:quant]`; llama-server answers to any name (the
 * alias, or the repo); mlx_lm.server loads the repo it is asked for, and `default_model` means
 * the one it was started with (unverified for folders, see docs/providers.md); LM Studio's
 * identifier is a guess the user can edit.
 */
export function servedModelName(runtime: LocalRuntimeId, source: LocalModelSource): string {
  if (source.kind === 'file') {
    if (runtime === 'mlx') return 'default_model';
    return nameFromFile(source.path);
  }
  const ref = `${source.repo}${source.quant ? `:${source.quant}` : ''}`;
  switch (runtime) {
    case 'ollama':
      return `hf.co/${ref}`;
    case 'lmstudio':
      return (source.repo.split('/')[1] ?? source.repo).toLowerCase();
    default:
      return source.repo;
  }
}
