import {
  Check,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Copy,
  ExternalLink,
  X,
} from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Button } from '../components/ui/button';
import { cn } from '../lib/cn';
import { copyText } from '../lib/clipboard';
import { appVersion } from '../lib/data-location';
import { openExternal } from '../lib/external';
import { isTauri } from '../lib/tauri';
import { useBridgeStore } from '../stores/bridge';
import { usePrefs } from '../stores/prefs';
import { useQa } from '../stores/qa';
import { toast } from '../stores/toast';
import { AREA_LABELS, QA_AREAS, QA_ITEMS, type QaArea, type QaItem } from './checklist';
import {
  currentResult,
  issueUrl,
  resultsMarkdown,
  summarize,
  type QaEnvironment,
  type QaStatus,
} from './report';
import { SCENARIOS } from './scenarios';

type Filter = 'open' | 'all' | 'fail';

const NEEDS_LABEL: Record<QaItem['needs'], string> = {
  any: 'Anywhere',
  'windows-desktop': 'Windows desktop app',
  'mac-desktop': 'Mac desktop app',
  'real-login': 'A real login or key',
  network: 'Network',
};

const STATUS_STYLE: Record<QaStatus, string> = {
  pass: 'bg-success',
  fail: 'bg-danger',
  skip: 'bg-fg-subtle',
};

/** What a failure report needs to say about this build, gathered at the moment it is used. */
function useEnvironment(): QaEnvironment {
  const prefs = usePrefs((s) => s.prefs);
  const ping = useBridgeStore((s) => s.lastPing);
  const [version, setVersion] = useState('?');
  useEffect(() => {
    void appVersion().then(setVersion, () => setVersion('dev'));
  }, []);
  return {
    appVersion: version,
    bridge: ping ? `${ping.bridgeVersion} (protocol ${ping.protocolVersion})` : 'not connected',
    platform: typeof navigator === 'undefined' ? 'unknown' : navigator.platform,
    tier: prefs.performance.tier,
    theme: prefs.appearance.theme,
    motion: prefs.appearance.motion,
    desktop: isTauri(),
  };
}

function Item({
  item,
  env,
  onTouch,
}: {
  item: QaItem;
  env: QaEnvironment;
  /** Called when the user answers or sets up, so the panel keeps this row on screen. */
  onTouch: (id: string) => void;
}) {
  const results = useQa((s) => s.results);
  const answer = useQa((s) => s.answer);
  const clear = useQa((s) => s.clear);
  const result = currentResult(item, results);
  const [open, setOpen] = useState(false);
  const [failing, setFailing] = useState(false);
  const [note, setNote] = useState(result?.note ?? '');
  const [setupNote, setSetupNote] = useState('');
  const scenario = item.setup ? SCENARIOS[item.setup] : null;

  return (
    <li className="rounded-control border border-border bg-bg" data-testid={`qa-item-${item.id}`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-2 p-2 text-left"
      >
        {open ? (
          <ChevronDown size={13} className="mt-0.5 shrink-0" />
        ) : (
          <ChevronRight size={13} className="mt-0.5 shrink-0" />
        )}
        <span className="min-w-0 flex-1">
          <span className="block font-mono text-[10px] text-fg-subtle">
            {item.id} · {NEEDS_LABEL[item.needs]}
            {item.destructive ? ' · erases data' : ''}
          </span>
          <span className="block text-[12px]">{item.title}</span>
        </span>
        <span
          className={cn(
            'mt-1 size-2.5 shrink-0 rounded-full border border-border-strong',
            result ? STATUS_STYLE[result.status] : 'bg-transparent',
          )}
          role="img"
          aria-label={result ? result.status : 'not tested'}
        />
      </button>

      {open && (
        <div className="flex flex-col gap-2 border-t border-border p-2 text-[12px]">
          <ol className="list-decimal pl-5 text-fg-muted">
            {item.steps.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
          <p>
            <span className="font-medium">Expected: </span>
            <span className="text-fg-muted">{item.expected}</span>
          </p>

          {scenario && (
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => setSetupNote(scenario.run() ?? '')}>
                Set up: {scenario.label}
              </Button>
              {setupNote && <span className="text-[11px] text-fg-subtle">{setupNote}</span>}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-2">
            <Button
              size="sm"
              variant={result?.status === 'pass' ? 'primary' : 'secondary'}
              onClick={() => {
                onTouch(item.id);
                setFailing(false);
                answer(item, 'pass');
              }}
            >
              Pass
            </Button>
            <Button
              size="sm"
              variant={result?.status === 'fail' ? 'primary' : 'secondary'}
              onClick={() => {
                onTouch(item.id);
                setFailing(true);
                answer(item, 'fail', note);
              }}
            >
              Fail
            </Button>
            <Button
              size="sm"
              variant={result?.status === 'skip' ? 'primary' : 'secondary'}
              onClick={() => {
                onTouch(item.id);
                setFailing(false);
                answer(item, 'skip');
              }}
            >
              Skip
            </Button>
            {result && (
              <button
                type="button"
                className="text-[11px] text-fg-subtle underline-offset-2 hover:underline"
                onClick={() => {
                  clear(item.id);
                  setFailing(false);
                  setNote('');
                }}
              >
                Clear
              </button>
            )}
          </div>

          {(failing || result?.status === 'fail') && (
            <div className="flex flex-col gap-2">
              <label className="flex flex-col gap-1 text-[11px] text-fg-subtle">
                What did you see?
                <textarea
                  value={note}
                  rows={3}
                  onChange={(e) => {
                    onTouch(item.id);
                    setNote(e.target.value);
                    answer(item, 'fail', e.target.value);
                  }}
                  className="selectable resize-y rounded-control border border-border bg-surface p-2 text-[12px] text-fg outline-none focus:border-accent"
                />
              </label>
              <div>
                <Button
                  size="sm"
                  variant="primary"
                  onClick={() => void openExternal(issueUrl(item, note, env))}
                >
                  <ExternalLink size={12} aria-hidden="true" />
                  Report on GitHub
                </Button>
              </div>
            </div>
          )}
        </div>
      )}
    </li>
  );
}

/**
 * The in-app QA drawer: the manual test checklist with one-click setup, pass/fail/skip, and a
 * button that opens a prefilled GitHub issue for a failure. Toggled with Ctrl+Shift+Q (Cmd+Shift+Y
 * on macOS) or the command palette; Settings turns it on for release builds.
 */
export function QaPanel() {
  const enabled = useQa((s) => s.enabled);
  const open = useQa((s) => s.open);
  const setOpen = useQa((s) => s.setOpen);
  const results = useQa((s) => s.results);
  const resetAll = useQa((s) => s.resetAll);
  const env = useEnvironment();
  const [filter, setFilter] = useState<Filter>('open');
  const [area, setArea] = useState<QaArea | 'all'>('all');
  // The row just answered stays listed (so a failure's note can be written) until another
  // item is touched or a filter changes.
  const [pinned, setPinned] = useState<string | null>(null);

  const summary = useMemo(() => summarize(QA_ITEMS, results), [results]);
  const visible = useMemo(
    () =>
      QA_ITEMS.filter((item) => {
        if (item.id === pinned) return true;
        if (area !== 'all' && item.area !== area) return false;
        const status = currentResult(item, results)?.status;
        if (filter === 'open') return status === undefined;
        if (filter === 'fail') return status === 'fail';
        return true;
      }),
    [area, filter, results, pinned],
  );

  if (!enabled || !open) return null;

  return (
    <aside
      aria-label="QA checklist"
      data-testid="qa-panel"
      className="fixed top-11 right-0 bottom-7 z-[60] flex w-[24rem] max-w-full flex-col border-l border-border-strong bg-elevated shadow-2xl"
    >
      <header className="flex items-center gap-2 border-b border-border px-3 py-2">
        <ClipboardList size={14} aria-hidden="true" />
        <h2 className="text-[13px] font-semibold">QA checklist</h2>
        <span className="ml-auto font-mono text-[11px] text-fg-subtle" data-testid="qa-summary">
          {summary.pass}/{summary.total} pass · {summary.fail} fail
        </span>
        <button
          type="button"
          aria-label="Close QA panel"
          onClick={() => setOpen(false)}
          className="grid size-6 place-items-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </header>

      <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 text-[11px]">
        <select
          aria-label="Filter by status"
          value={filter}
          onChange={(e) => {
            setPinned(null);
            setFilter(e.target.value as Filter);
          }}
          className="h-7 rounded-control border border-border bg-bg px-1.5"
        >
          <option value="open">Not tested ({summary.untested})</option>
          <option value="fail">Failed ({summary.fail})</option>
          <option value="all">All ({summary.total})</option>
        </select>
        <select
          aria-label="Filter by area"
          value={area}
          onChange={(e) => {
            setPinned(null);
            setArea(e.target.value as QaArea | 'all');
          }}
          className="h-7 rounded-control border border-border bg-bg px-1.5"
        >
          <option value="all">All areas</option>
          {QA_AREAS.map((a) => (
            <option key={a} value={a}>
              {AREA_LABELS[a]}
            </option>
          ))}
        </select>
      </div>

      <ul className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <li className="py-6 text-center text-[12px] text-fg-subtle">
            {filter === 'open' ? (
              <span className="inline-flex items-center gap-1">
                <Check size={13} aria-hidden="true" /> Nothing left to test here.
              </span>
            ) : (
              'No items match.'
            )}
          </li>
        ) : (
          visible.map((item) => (
            <Item key={`${item.id}-${item.rev}`} item={item} env={env} onTouch={setPinned} />
          ))
        )}
      </ul>

      <footer className="flex flex-wrap items-center gap-2 border-t border-border px-3 py-2">
        <Button
          size="sm"
          onClick={() =>
            void copyText(resultsMarkdown(results, env)).then((ok) =>
              toast(ok ? 'Results copied as Markdown' : 'Could not copy'),
            )
          }
        >
          <Copy size={12} aria-hidden="true" />
          Copy results
        </Button>
        <Button size="sm" onClick={() => resetAll()}>
          Reset
        </Button>
      </footer>
    </aside>
  );
}
