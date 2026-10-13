import { MODEL_OPTIONS } from '@programish/protocol';
import { Download, FolderOpen, Trash2 } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { clearData, countData, exportAll, type ClearScope, type DataCounts } from '../../lib/data';
import {
  appVersion,
  getDataLocation,
  revealDataFile,
  type DataLocation,
} from '../../lib/data-location';
import { getDb } from '../../lib/db';
import { saveTextFile } from '../../lib/save-file';
import { chatStore } from '../../stores/chat';
import { conversationsStore } from '../../stores/conversations';
import { projectsStore } from '../../stores/projects';
import { promptsStore } from '../../stores/prompts';
import { CODE_FONT_SIZES, UI_SCALES, useSettings } from '../../stores/settings';
import { toast } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { usageStore } from '../../stores/usage';
import { Button } from '../ui/button';
import { ConfirmDialog } from '../ui/dialog';
import { Segmented } from '../ui/segmented';

function Section({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section
      aria-labelledby={`settings-${title}`}
      className="rounded-panel border border-border bg-surface p-4"
    >
      <h2 id={`settings-${title}`} className="text-sm font-semibold">
        {title}
      </h2>
      {hint && <p className="mt-0.5 text-[11px] text-fg-subtle">{hint}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px]">{label}</p>
        {hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  );
}

const CLEAR_COPY: Record<ClearScope, { button: string; title: string; body: string }> = {
  usage: {
    button: 'Clear usage history',
    title: 'Clear usage history?',
    body: 'Token counts, costs and the saved plan readings are deleted. Conversations are not touched. This cannot be undone.',
  },
  prompts: {
    button: 'Clear prompts and projects',
    title: 'Clear prompts and projects?',
    body: 'Every saved prompt, system prompt and project is deleted. Conversations are kept but lose their project and attached system prompt. This cannot be undone.',
  },
  everything: {
    button: 'Clear all data',
    title: 'Delete everything?',
    body: 'All conversations, messages, prompts, projects and usage history are deleted from this computer. Export first if you want a copy. This cannot be undone.',
  },
};

/** Preferences, defaults for new chats, and what the app stores (with export and clear). */
export function SettingsView() {
  const theme = useUiStore((s) => s.theme);
  const settings = useSettings((s) => s);
  const [location, setLocation] = useState<DataLocation | null>(null);
  const [version, setVersion] = useState('');
  const [counts, setCounts] = useState<DataCounts | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState<ClearScope | null>(null);

  const refreshCounts = async () => {
    try {
      setCounts(await countData(await getDb()));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  useEffect(() => {
    // Promise callbacks, not synchronous setState: the effect only subscribes to the loads.
    void getDb()
      .then(countData)
      .then(setCounts, (err: unknown) =>
        setError(err instanceof Error ? err.message : String(err)),
      );
    void getDataLocation().then(setLocation, () => setLocation(null));
    void appVersion().then(setVersion, () => setVersion(''));
  }, []);

  const exportData = async () => {
    try {
      const file = await exportAll(await getDb());
      if (await saveTextFile('programish-data.json', JSON.stringify(file, null, 2)))
        toast('Data exported');
    } catch (err) {
      toast(`Could not export: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const clear = async (scope: ClearScope) => {
    setConfirming(null);
    try {
      await clearData(await getDb(), scope);
      if (scope === 'everything') {
        conversationsStore.getState().newChat();
        await chatStore.getState().loadMessages(null);
      }
      await Promise.all([
        conversationsStore.getState().load(),
        promptsStore.getState().load(),
        projectsStore.getState().load(),
        usageStore.getState().load(),
        refreshCounts(),
      ]);
      usageStore.setState({ conversationTotals: {} });
      // Emptying the open chat resets the selection, which normally returns to the chat view.
      useUiStore.getState().setView('settings');
      toast('Data cleared');
    } catch (err) {
      toast(`Could not clear: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  return (
    <div className="min-h-0 flex-1 overflow-y-auto" data-testid="settings-view">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-5">
        <header>
          <h1 className="text-base font-semibold tracking-tight">Settings</h1>
          <p className="text-[11px] text-fg-subtle">
            Changes apply immediately and are kept on this computer.
          </p>
        </header>

        <Section title="Appearance">
          <Row label="Theme">
            <Segmented
              label="Theme"
              value={theme}
              options={[
                { value: 'dark', label: 'Dark' },
                { value: 'light', label: 'Light' },
              ]}
              onChange={(t) => t !== theme && useUiStore.getState().toggleTheme()}
            />
          </Row>
          <Row label="Interface size" hint="Scales the whole window.">
            <Segmented
              label="Interface size"
              value={settings.uiScale}
              options={UI_SCALES.map((v) => ({ value: v, label: `${v}%` }))}
              onChange={settings.setUiScale}
            />
          </Row>
          <Row label="Code font size" hint="Code blocks and diffs, in pixels.">
            <Segmented
              label="Code font size"
              value={settings.codeFontSize}
              options={CODE_FONT_SIZES.map((v) => ({ value: v, label: String(v) }))}
              onChange={settings.setCodeFontSize}
            />
          </Row>
        </Section>

        <Section
          title="New chats"
          hint="What a chat starts with. You can still change both per chat."
        >
          <Row label="Default model">
            <select
              aria-label="Default model"
              value={settings.defaultModel ?? 'default'}
              onChange={(e) =>
                settings.setDefaultModel(e.target.value === 'default' ? null : e.target.value)
              }
              className="h-8 rounded-control border border-border bg-bg px-2 text-[13px] outline-none focus:border-border-strong"
            >
              {MODEL_OPTIONS.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.label}
                </option>
              ))}
            </select>
          </Row>
          <label className="flex flex-col gap-1 text-[13px]">
            Default system prompt
            <textarea
              value={settings.defaultSystemPrompt}
              rows={4}
              placeholder="Optional instructions every new chat starts with…"
              onChange={(e) => settings.setDefaultSystemPrompt(e.target.value)}
              className="selectable resize-y rounded-control border border-border bg-bg p-2 font-mono text-xs outline-none focus:border-border-strong"
            />
            <span className="text-[11px] text-fg-subtle">
              A project's default or a library prompt attached to a chat takes over only when this
              chat has no text of its own, so this text is copied into each new chat.
            </span>
          </label>
        </Section>

        <Section
          title="Data"
          hint="Everything is stored locally in one SQLite file. Nothing is uploaded except the messages you send to Claude."
        >
          <Row
            label="Location"
            hint={location ? undefined : 'Browser storage (running outside the desktop app).'}
          >
            {location && (
              <div className="flex min-w-0 items-center gap-2">
                <code
                  className="selectable max-w-[22rem] truncate font-mono text-[11px] text-fg-muted"
                  title={location.dbFile}
                >
                  {location.dbFile}
                </code>
                <Button size="sm" onClick={() => void revealDataFile(location)}>
                  <FolderOpen size={12} />
                  Show in folder
                </Button>
              </div>
            )}
          </Row>
          <p className="text-xs text-fg-muted" data-testid="data-counts">
            {counts
              ? `${counts.conversations} conversations, ${counts.messages} messages, ${counts.prompts} prompts, ${counts.projects} projects, ${counts.usageRows} usage records`
              : error
                ? `Could not read the database: ${error}`
                : 'Counting…'}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void exportData()}>
              <Download size={12} />
              Export all data (JSON)
            </Button>
            {(['usage', 'prompts', 'everything'] as const).map((scope) => (
              <Button key={scope} size="sm" onClick={() => setConfirming(scope)}>
                <Trash2 size={12} />
                {CLEAR_COPY[scope].button}
              </Button>
            ))}
          </div>
        </Section>

        <Section title="About">
          <p className="text-xs text-fg-muted">
            Programish {version && `v${version}`}. Chats run on your Claude subscription through
            your Claude Code login; no API key is stored or used.
          </p>
          <div>
            <Button size="sm" onClick={() => settings.reset()}>
              Reset display and new-chat settings
            </Button>
          </div>
        </Section>
      </div>

      <ConfirmDialog
        open={confirming !== null}
        title={confirming ? CLEAR_COPY[confirming].title : ''}
        confirmLabel="Delete"
        destructive
        onCancel={() => setConfirming(null)}
        onConfirm={() => confirming && void clear(confirming)}
      >
        <p>{confirming ? CLEAR_COPY[confirming].body : ''}</p>
      </ConfirmDialog>
    </div>
  );
}
