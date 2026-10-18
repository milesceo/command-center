import {
  LOCAL_RUNTIME_INFO,
  isAbsolutePath,
  type LocalRuntimeId,
  type RuntimeStatus,
} from '@command-center/protocol';
import {
  Download,
  FolderOpen,
  Heart,
  Lock,
  Search,
  SquareTerminal,
  TriangleAlert,
} from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import { getBridgeClient } from '../../lib/bridge-client';
import { cn } from '../../lib/cn';
import {
  addWarnings,
  formatBytes,
  ggufChoices,
  isMlxRepo,
  listFiles,
  modelInfo,
  parseModelReference,
  searchModels,
  type GgufChoice,
  type HubFile,
  type HubFilter,
  type HubModel,
  type HubModelInfo,
  type Warning,
} from '../../lib/hf-hub';
import {
  baseRepo,
  defaultName,
  draftToInput,
  fileFormat,
  localSource,
  previewCommand,
  runRequest,
  runtimesFor,
  type DraftSource,
} from '../../lib/model-draft';
import type { CustomModel } from '../../lib/repo-models';
import { platformCopy } from '../../lib/platform-copy';
import { isMacPlatform } from '../../lib/shortcuts';
import { system } from '../../lib/system';
import { isTauri } from '../../lib/tauri';
import { ensureBridge } from '../../stores/bridge';
import { useCustomModels } from '../../stores/custom-models';
import { useProviders } from '../../stores/providers';
import { Button } from '../ui/button';
import { CopyButton } from '../ui/copy-button';
import { Modal } from '../ui/dialog';
import { Segmented } from '../ui/segmented';

type Tab = 'search' | 'paste' | 'file';
type Route = 'cloud' | 'local';

const TABS = [
  { value: 'search', label: 'Search Hugging Face' },
  { value: 'paste', label: 'Paste a link' },
  { value: 'file', label: 'From a file' },
] as const;

const FILTERS = [
  { value: 'any', label: 'All' },
  { value: 'gguf', label: 'GGUF' },
  { value: 'mlx', label: 'MLX' },
] as const;

const inputClass =
  'h-8 w-full rounded-control border border-border bg-bg px-2 text-[13px] outline-none placeholder:text-fg-subtle focus:border-border-strong';

const compact = new Intl.NumberFormat(undefined, { notation: 'compact' });

/** Warnings use the badge look (text-warning alone is below AA on light surfaces). */
const warnBox = 'flex items-start gap-1.5 rounded-control bg-warning/15 px-2 py-1 text-fg';

/** Picks a `.gguf` file or an MLX model folder with the native dialog. */
async function pickModel(kind: 'gguf' | 'mlx'): Promise<string | null> {
  if (!isTauri()) return null;
  const { open } = await import('@tauri-apps/plugin-dialog');
  const picked = await open(
    kind === 'gguf'
      ? { multiple: false, filters: [{ name: 'GGUF model', extensions: ['gguf'] }] }
      : { multiple: false, directory: true },
  );
  return typeof picked === 'string' ? picked : null;
}

/** The quant to preselect: Q4_K_M when offered (a common size/quality balance), else the smallest. */
function preferredQuant(choices: GgufChoice[]): GgufChoice | null {
  return choices.find((c) => c.quant === 'Q4_K_M') ?? choices[0] ?? null;
}

interface Props {
  onClose: () => void;
  onAdded: (model: CustomModel) => void;
  /** Injected in stories and tests; the real Hub otherwise. */
  fetchImpl?: typeof fetch;
}

/**
 * Add a model: find it on Hugging Face (search or a pasted link) or pick a file on this
 * computer, then choose where it runs. The cloud route uses Hugging Face Inference Providers with
 * the user's token; the local route shows the exact command for the user's own runtime, which
 * they can copy or open in Terminal. Nothing is downloaded by Command Center.
 */
export function AddModelDialog({ onClose, onAdded, fetchImpl = fetch }: Props) {
  const [tab, setTab] = useState<Tab>('search');
  const [source, setSource] = useState<DraftSource | null>(null);
  const [info, setInfo] = useState<HubModelInfo | null>(null);
  const [files, setFiles] = useState<HubFile[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [memory, setMemory] = useState<number | null>(null);
  const lookup = useRef(0);

  useEffect(() => {
    void system.memory().then(setMemory);
  }, []);

  const choose = async (repo: string) => {
    const seq = ++lookup.current;
    setSource(null);
    setLookupError(null);
    setLoading(true);
    try {
      const [details, tree] = await Promise.all([
        modelInfo(repo, fetchImpl),
        listFiles(repo, fetchImpl).catch(() => [] as HubFile[]),
      ]);
      if (seq !== lookup.current) return;
      const format = ggufChoices(tree).length > 0 ? 'gguf' : isMlxRepo(details) ? 'mlx' : 'other';
      setInfo(details);
      setFiles(tree);
      setSource({ kind: 'hub', repo, format });
    } catch (err) {
      if (seq === lookup.current) setLookupError(err instanceof Error ? err.message : String(err));
    } finally {
      if (seq === lookup.current) setLoading(false);
    }
  };

  const chooseFile = (path: string) => {
    lookup.current++;
    setInfo(null);
    setFiles([]);
    setLookupError(null);
    setSource({ kind: 'file', path, format: fileFormat(path) });
  };

  return (
    <Modal title="Add a model" onClose={onClose} width="max-w-2xl">
      <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-4 py-3 text-xs">
        <Segmented
          label="Where the model comes from"
          value={tab}
          options={TABS}
          onChange={setTab}
        />
        {tab === 'search' && (
          <SearchTab fetchImpl={fetchImpl} selected={source} onChoose={(r) => void choose(r)} />
        )}
        {tab === 'paste' && <PasteTab onChoose={(r) => void choose(r)} />}
        {tab === 'file' && <FileTab onChoose={chooseFile} />}

        {loading && (
          <p role="status" className="text-fg-subtle">
            Reading the model from Hugging Face…
          </p>
        )}
        {lookupError && (
          <p role="alert" className="text-danger">
            {lookupError}
          </p>
        )}
        {source && (
          <Configure
            key={source.kind === 'hub' ? source.repo : source.path}
            source={source}
            info={info}
            files={files}
            memory={memory}
            onAdded={onAdded}
            onCancel={onClose}
          />
        )}
      </div>
    </Modal>
  );
}

function SearchTab({
  fetchImpl,
  selected,
  onChoose,
}: {
  fetchImpl: typeof fetch;
  selected: DraftSource | null;
  onChoose: (repo: string) => void;
}) {
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<HubFilter>('gguf');
  const [found, setResults] = useState<HubModel[] | null>(null);
  const [searchError, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Searches as the user types, a moment after the last key, and drops answers that arrive late.
  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setBusy(true);
      searchModels(text, filter, fetchImpl, controller.signal)
        .then((list) => {
          setResults(list);
          setError(null);
        })
        .catch((err: unknown) => {
          if (!controller.signal.aborted) {
            setError(err instanceof Error ? err.message : 'Could not search Hugging Face.');
          }
        })
        .finally(() => setBusy(false));
    }, 300);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, filter, fetchImpl]);

  const selectedRepo = selected?.kind === 'hub' ? selected.repo : null;
  // Fewer than two characters shows nothing (old answers stay hidden rather than cleared).
  const active = query.trim().length >= 2;
  const results = active ? found : null;
  const error = active ? searchError : null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <Search
            size={13}
            className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-fg-subtle"
          />
          <input
            type="search"
            autoFocus
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search chat models, e.g. qwen 0.5b"
            aria-label="Search Hugging Face models"
            className={`${inputClass} pl-7`}
          />
        </div>
        <Segmented label="Format" value={filter} options={FILTERS} onChange={setFilter} />
      </div>
      <p className="text-[11px] text-fg-subtle">
        GGUF runs with Ollama, llama.cpp or LM Studio; MLX runs with MLX-LM on Apple Silicon. Any
        model can be tried in the cloud if a Hugging Face provider serves it.
      </p>
      {active && busy && results === null && (
        <p role="status" className="text-fg-subtle">
          Searching…
        </p>
      )}
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      {results && results.length === 0 && <p className="text-fg-subtle">No models found.</p>}
      {results && results.length > 0 && (
        <ul
          aria-label="Search results"
          className="flex max-h-56 flex-col overflow-y-auto rounded-control border border-border"
        >
          {results.map((m) => (
            <li key={m.id} className="border-b border-border last:border-b-0">
              <button
                type="button"
                aria-pressed={selectedRepo === m.id}
                onClick={() => onChoose(m.id)}
                className={cn(
                  'flex w-full items-center gap-3 px-2.5 py-1.5 text-left hover:bg-hover',
                  selectedRepo === m.id && 'bg-hover',
                )}
              >
                <span className="min-w-0 flex-1 truncate font-mono text-[12px]">{m.id}</span>
                {m.gated && (
                  <span className="flex items-center gap-1 rounded-full bg-warning/15 px-1.5 text-[11px] text-fg">
                    <Lock size={11} aria-hidden />
                    Gated
                  </span>
                )}
                <span className="flex items-center gap-1 text-[11px] text-fg-subtle tabular-nums">
                  <Download size={11} aria-hidden />
                  {compact.format(m.downloads)}
                  <span className="sr-only">downloads</span>
                </span>
                <span className="flex items-center gap-1 text-[11px] text-fg-subtle tabular-nums">
                  <Heart size={11} aria-hidden />
                  {compact.format(m.likes)}
                  <span className="sr-only">likes</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function PasteTab({ onChoose }: { onChoose: (repo: string) => void }) {
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-col gap-2"
      onSubmit={(e) => {
        e.preventDefault();
        const repo = parseModelReference(text);
        if (!repo) {
          setError('Paste a model id like owner/name or a huggingface.co/owner/name link.');
          return;
        }
        setError(null);
        onChoose(repo);
      }}
    >
      <div className="flex gap-2">
        <input
          autoFocus
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF"
          aria-label="Model id or link"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <Button type="submit" variant="primary">
          Look up
        </Button>
      </div>
      <p className="text-[11px] text-fg-subtle">
        For the cloud, add <span className="font-mono">:fastest</span>,{' '}
        <span className="font-mono">:cheapest</span> or a provider name to choose who serves it.
      </p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </form>
  );
}

function FileTab({ onChoose }: { onChoose: (path: string) => void }) {
  const [path, setPath] = useState('');
  const [error, setError] = useState<string | null>(null);
  const submitPath = (value: string) => {
    const p = value.trim();
    if (!isAbsolutePath(p)) {
      setError('Use the full path, starting with /.');
      return;
    }
    setError(null);
    onChoose(p);
  };
  const pick = async (kind: 'gguf' | 'mlx') => {
    const picked = await pickModel(kind).catch(() => null);
    if (picked) {
      setPath(picked);
      submitPath(picked);
    }
  };
  return (
    <div className="flex flex-col gap-2">
      <p className="text-fg-muted">
        A <span className="font-mono">.gguf</span> file or an MLX model folder already on this
        computer. It stays where it is and never leaves {platformCopy.thisComputer()}; your runtime
        reads it from there.
      </p>
      {isTauri() && (
        <div className="flex gap-2">
          <Button size="sm" onClick={() => void pick('gguf')}>
            <FolderOpen size={12} />
            Choose a .gguf file
          </Button>
          <Button size="sm" onClick={() => void pick('mlx')}>
            <FolderOpen size={12} />
            Choose an MLX folder
          </Button>
        </div>
      )}
      <form
        className="flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          submitPath(path);
        }}
      >
        <input
          value={path}
          onChange={(e) => setPath(e.target.value)}
          placeholder="/Users/you/Models/model-Q4_K_M.gguf"
          aria-label="Path to the model file or folder"
          spellCheck={false}
          className={`${inputClass} font-mono`}
        />
        <Button type="submit">Use path</Button>
      </form>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

const RUNTIME_STATE = (s: RuntimeStatus | undefined) =>
  !s ? 'not checked' : s.running ? 'running' : s.installed ? 'installed' : 'not installed';

function Configure({
  source,
  info,
  files,
  memory,
  onAdded,
  onCancel,
}: {
  source: DraftSource;
  info: HubModelInfo | null;
  files: HubFile[];
  memory: number | null;
  onAdded: (model: CustomModel) => void;
  onCancel: () => void;
}) {
  const hasToken = useProviders((s) => s.hasKey.huggingface);
  const runtimes = useProviders((s) => s.infos.local?.runtimes);
  const choices = useMemo(() => ggufChoices(files), [files]);
  const localRuntimes = runtimesFor(source);
  const canCloud = source.kind === 'hub';

  const status = (id: LocalRuntimeId) => runtimes?.find((r) => r.id === id);
  const [route, setRoute] = useState<Route>(localRuntimes.length > 0 ? 'local' : 'cloud');
  const [runtime, setRuntime] = useState<LocalRuntimeId | null>(
    () =>
      localRuntimes.find((id) => status(id)?.running) ??
      localRuntimes.find((id) => status(id)?.installed) ??
      localRuntimes[0] ??
      null,
  );
  // Chosen by file, so GGUF files without a recognisable quant tag stay distinct.
  const [chosenFile, setChosenFile] = useState<string | null>(
    () => preferredQuant(choices)?.file ?? null,
  );
  const chosen = choices.find((c) => c.file === chosenFile) ?? null;
  const quant = chosen?.quant ?? null;
  // The name follows the repo and quant until the user types their own.
  const [typedName, setName] = useState<string | null>(null);
  const name = typedName ?? defaultName(source, route === 'local' ? quant : null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'save' | 'run' | null>(null);
  const panel = useRef<HTMLElement>(null);

  // Picking a result below a long list: bring the details into view and move focus to them.
  useEffect(() => {
    panel.current?.scrollIntoView?.({ block: 'nearest' });
    panel.current?.querySelector<HTMLElement>('h3')?.focus();
  }, []);

  // Check which runtimes are installed and running, once, when the local route is possible.
  useEffect(() => {
    if (localRuntimes.length > 0 && !runtimes) void useProviders.getState().refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sizeBytes =
    source.format === 'gguf'
      ? chosen?.size
      : files.filter((f) => /\.safetensors$/i.test(f.path)).reduce((n, f) => n + f.size, 0) ||
        undefined;

  const warnings: Warning[] = info
    ? addWarnings(info, {
        route,
        hasToken,
        memoryBytes: memory,
        ...(route === 'local' && sizeBytes ? { sizeBytes } : {}),
      })
    : [];

  const request =
    route === 'local' && runtime ? runRequest(runtime, localSource(source, quant)) : null;
  const command = request ? previewCommand(request) : null;

  const save = async () => {
    setError(null);
    setBusy('save');
    try {
      const input = draftToInput(
        source,
        route === 'cloud'
          ? { route: 'cloud' }
          : { route: 'local', runtime: runtime ?? 'ollama', quant, adapterPath: null },
        name,
      );
      onAdded(await useCustomModels.getState().add(input));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  const runInTerminal = async () => {
    if (!request) return;
    setError(null);
    setBusy('run');
    try {
      await ensureBridge();
      const report = await getBridgeClient().localRun(request);
      const local = report.find((p) => p.id === 'local');
      if (local) useProviders.setState((s) => ({ infos: { ...s.infos, local } }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <section
      ref={panel}
      aria-label="Model details"
      className="flex flex-col gap-3 rounded-panel border border-border bg-surface p-3"
    >
      <header className="flex flex-col gap-0.5">
        <h3 tabIndex={-1} className="truncate font-mono text-[13px] outline-none">
          {source.kind === 'hub' ? source.repo : source.path}
        </h3>
        <p className="text-[11px] text-fg-subtle">
          {source.kind === 'file'
            ? source.format === 'gguf'
              ? 'GGUF file on this computer'
              : 'MLX folder on this computer'
            : [
                info?.license ? `License ${info.license}` : null,
                info?.parameters ? `${compact.format(info.parameters)} parameters` : null,
                source.format === 'gguf' ? 'GGUF' : source.format === 'mlx' ? 'MLX' : null,
                info?.gated ? 'Gated' : null,
              ]
                .filter(Boolean)
                .join(' · ') || 'Hugging Face model'}
        </p>
      </header>

      <Segmented
        label="Where it runs"
        value={route}
        onChange={setRoute}
        options={[
          ...(localRuntimes.length > 0
            ? [{ value: 'local' as const, label: `On ${platformCopy.thisComputer()}` }]
            : []),
          ...(canCloud ? [{ value: 'cloud' as const, label: 'Hugging Face cloud' }] : []),
        ]}
      />
      {route === 'cloud' ? (
        <p className="text-fg-muted">
          Chats go to Hugging Face Inference Providers with your token. Usage is billed by Hugging
          Face (free accounts include a small monthly credit).
        </p>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-fg-muted">Runtime</span>
            <select
              value={runtime ?? ''}
              onChange={(e) => setRuntime(e.target.value as LocalRuntimeId)}
              className={inputClass}
            >
              {localRuntimes.map((id) => (
                <option key={id} value={id} className="bg-elevated">
                  {LOCAL_RUNTIME_INFO[id].label} ({RUNTIME_STATE(status(id))})
                </option>
              ))}
            </select>
          </label>
          {source.kind === 'hub' && choices.length > 0 && (
            <label className="flex flex-col gap-1">
              <span className="text-fg-muted">
                Quantisation (smaller is faster, larger is better)
              </span>
              <select
                value={chosenFile ?? ''}
                onChange={(e) => setChosenFile(e.target.value || null)}
                className={inputClass}
              >
                {choices.map((c) => (
                  <option key={c.file} value={c.file} className="bg-elevated">
                    {c.quant ?? c.file} · {formatBytes(c.size)}
                  </option>
                ))}
              </select>
            </label>
          )}
          {runtime && status(runtime) && !status(runtime)?.installed && (
            <p className={warnBox}>
              <TriangleAlert size={12} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              {LOCAL_RUNTIME_INFO[runtime].label} is not installed. Install it first (see its
              website), or pick another runtime.
            </p>
          )}
          {command && (
            <div className="flex flex-col gap-1">
              <span className="text-fg-muted">
                {isMacPlatform()
                  ? 'Command (downloads the model if needed, then serves it; Terminal runs it when you press Enter there)'
                  : 'Command to run in a terminal (downloads the model if needed, then serves it)'}
              </span>
              <div className="flex items-start gap-1 rounded-control border border-border bg-bg p-2">
                <code className="selectable min-w-0 flex-1 font-mono text-[12px] break-all">
                  {command}
                </code>
                <CopyButton text={command} label="Copy command" />
              </div>
              {isMacPlatform() && (
                <div>
                  <Button size="sm" onClick={() => void runInTerminal()} disabled={busy !== null}>
                    <SquareTerminal size={12} />
                    {busy === 'run' ? 'Opening…' : 'Run in Terminal'}
                  </Button>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {warnings.length > 0 && (
        <ul className="flex flex-col gap-1">
          {warnings.map((w) => (
            <li key={w.text} className={w.level === 'warn' ? warnBox : 'text-fg-muted'}>
              {w.level === 'warn' && (
                <TriangleAlert size={12} aria-hidden className="mt-0.5 shrink-0 text-warning" />
              )}
              {w.text}
            </li>
          ))}
        </ul>
      )}

      <label className="flex flex-col gap-1">
        <span className="text-fg-muted">Name in Command Center</span>
        <input
          value={name}
          maxLength={80}
          onChange={(e) => setName(e.target.value)}
          className={inputClass}
        />
      </label>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <Button onClick={onCancel}>Cancel</Button>
        <Button
          variant="primary"
          onClick={() => void save()}
          disabled={busy !== null || name.trim() === '' || (route === 'local' && !runtime)}
        >
          {source.kind === 'hub' ? `Add ${baseRepo(source.repo).split('/')[1]}` : 'Add model'}
        </Button>
      </div>
    </section>
  );
}
