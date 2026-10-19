import { ArrowUpToLine, FileText, Pencil, Plus, Trash2 } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { getDb } from '../../lib/db';
import { buildHtmlDocument } from '../../lib/preview-doc';
import {
  getPlan,
  MAX_PLAN_BYTES,
  PlanError,
  titleFromFileName,
  titleFromHtml,
  type PlanSummary,
} from '../../lib/repo-plans';
import { cn } from '../../lib/cn';
import { usePlans } from '../../stores/plans';
import { toast } from '../../stores/toast';
import { publishPreview, type Frame } from '../preview/PreviewFrame';
import { Button } from '../ui/button';
import { ConfirmDialog, Modal } from '../ui/dialog';
import { ListSkeleton } from '../ui/skeleton';

let builds = 0;

/**
 * One plan, shown exactly as it was made. The document is untrusted HTML, so it runs in the same
 * sandbox as code previews: an iframe with `allow-scripts` only, served from the `preview:`
 * scheme with its own CSP. Its scripts (calculators, checklists) and in-page links work; it cannot
 * reach the app or its storage, can load https resources but cannot fetch or send data, and
 * external links do not open.
 */
export function PlanReader({ plan }: { plan: PlanSummary }) {
  // Results are tagged with their plan, so nothing from the previous plan shows for this one.
  const [frame, setFrame] = useState<(Frame & { planId: string; key: number }) | null>(null);
  const [error, setError] = useState<{ planId: string; message: string } | null>(null);
  const [attempt, setAttempt] = useState(0);

  // Only the plan's id: a rename must not reload the page (and lose the reader's place).
  useEffect(() => {
    let current = true;
    void (async () => {
      try {
        const full = await getPlan(await getDb(), plan.id);
        if (!full) throw new Error('This plan was removed.');
        // One stable id per plan, so the Rust store replaces it instead of keeping copies.
        const id = `plan-${plan.id}`;
        const next = await publishPreview(id, buildHtmlDocument(full.html, id));
        if (current) setFrame({ ...next, planId: plan.id, key: ++builds });
      } catch (err) {
        if (current) {
          setError({ planId: plan.id, message: err instanceof Error ? err.message : String(err) });
        }
      }
    })();
    return () => {
      current = false;
    };
  }, [plan.id, attempt]);

  const ready = frame?.planId === plan.id;
  if (!ready && error?.planId === plan.id) {
    return (
      <div role="alert" className="flex items-center gap-2 p-4">
        <p className="text-danger">Could not open this plan: {error.message}</p>
        <Button
          size="sm"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
        >
          Retry
        </Button>
      </div>
    );
  }
  return (
    <div className="flex min-h-0 flex-1 bg-bg" data-testid="plan-reader" aria-busy={!ready}>
      {ready ? (
        <iframe
          key={frame.key}
          title={plan.title}
          sandbox="allow-scripts"
          referrerPolicy="no-referrer"
          {...(frame.src ? { src: frame.src } : { srcDoc: frame.srcDoc ?? '' })}
          className="h-full w-full border-0 bg-white"
        />
      ) : (
        <div className="w-full p-4">
          <ListSkeleton rows={4} />
        </div>
      )}
    </div>
  );
}

/** Business plans: a list on the left, the chosen plan to read on the right. */
export function BusinessPlansView() {
  const plans = usePlans((s) => s.plans);
  const loaded = usePlans((s) => s.loaded);
  const loadError = usePlans((s) => s.error);
  const selectedId = usePlans((s) => s.selectedId);
  const fileInput = useRef<HTMLInputElement>(null);
  const renameButton = useRef<HTMLButtonElement>(null);
  const [renaming, setRenaming] = useState<PlanSummary | null>(null);
  const [removing, setRemoving] = useState<PlanSummary | null>(null);

  useEffect(() => {
    if (!loaded) void usePlans.getState().load();
  }, [loaded]);

  const selected = plans.find((p) => p.id === selectedId) ?? plans[0] ?? null;

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      if (file.size > MAX_PLAN_BYTES) throw new PlanError('That plan is larger than 5 MB.');
      const html = await file.text();
      const title = titleFromHtml(html) ?? titleFromFileName(file.name);
      await usePlans.getState().add({ title, html, source: file.name });
      toast(`Added ${title}`);
    } catch (err) {
      toast(
        err instanceof PlanError
          ? err.message
          : `Could not add the plan: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col" data-testid="business-plans">
      <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="min-w-0">
          <h1 className="text-sm font-semibold tracking-tight">Business plans</h1>
          <p className="text-[11px] text-fg-subtle">Saved on this computer only.</p>
        </div>
        <input
          ref={fileInput}
          type="file"
          accept=".html,.htm,text/html"
          hidden
          data-testid="plan-file-input"
          onChange={(e) => {
            void importFile(e.target.files?.[0]);
            e.target.value = '';
          }}
        />
        <Button size="sm" variant="primary" onClick={() => fileInput.current?.click()}>
          <Plus size={12} />
          Add a plan
        </Button>
      </header>

      {!loaded ? (
        <div className="p-4">
          <ListSkeleton rows={3} />
        </div>
      ) : loadError ? (
        <div role="alert" className="flex items-center gap-2 p-4">
          <p className="text-danger">Could not read your plans: {loadError}</p>
          <Button size="sm" onClick={() => void usePlans.getState().load()}>
            Retry
          </Button>
        </div>
      ) : plans.length === 0 ? (
        <div className="m-4 flex flex-col items-start gap-2 rounded-panel border border-dashed border-border p-6">
          <p className="text-[13px] font-medium">No plans yet</p>
          <p className="text-xs text-fg-muted">
            Add a plan saved as an HTML file, such as a Claude artifact you downloaded.
          </p>
          <Button size="sm" variant="primary" onClick={() => fileInput.current?.click()}>
            <Plus size={12} />
            Add a plan
          </Button>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <nav
            aria-label="Plans"
            className="flex w-44 shrink-0 flex-col gap-0.5 overflow-y-auto border-r border-border p-2"
          >
            {plans.map((p) => (
              <button
                key={p.id}
                type="button"
                aria-current={selected?.id === p.id ? 'page' : undefined}
                onClick={() => usePlans.getState().select(p.id)}
                className={cn(
                  'flex items-start gap-2 rounded-control px-2 py-1.5 text-left text-xs hover:bg-hover',
                  selected?.id === p.id ? 'bg-hover text-fg' : 'text-fg-muted',
                )}
              >
                <FileText size={13} aria-hidden className="mt-0.5 shrink-0" />
                <span className="min-w-0 break-words">{p.title}</span>
              </button>
            ))}
          </nav>
          {selected && (
            <section aria-label="Plan reader" className="flex min-w-0 flex-1 flex-col">
              <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-3 py-1.5">
                <p
                  className="min-w-0 truncate text-xs text-fg-muted"
                  title={
                    selected.source ? `${selected.title} (${selected.source})` : selected.title
                  }
                >
                  {selected.title}
                </p>
                <div className="flex shrink-0 items-center gap-0.5">
                  {plans[0]?.id !== selected.id && (
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Move ${selected.title} to the top`}
                      title="Move to the top"
                      onClick={() =>
                        void usePlans
                          .getState()
                          .moveFirst(selected.id)
                          // The button disappears once the plan is first: keep focus nearby.
                          .then(() => renameButton.current?.focus())
                      }
                    >
                      <ArrowUpToLine size={14} />
                    </Button>
                  )}
                  <Button
                    variant="ghost"
                    size="icon"
                    ref={renameButton}
                    aria-label={`Rename ${selected.title}`}
                    title="Rename"
                    onClick={() => setRenaming(selected)}
                  >
                    <Pencil size={14} />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    aria-label={`Remove ${selected.title}`}
                    title="Remove"
                    onClick={() => setRemoving(selected)}
                  >
                    <Trash2 size={14} />
                  </Button>
                </div>
              </div>
              <PlanReader plan={selected} />
            </section>
          )}
        </div>
      )}

      {renaming && (
        <RenameDialog
          plan={renaming}
          onClose={() => setRenaming(null)}
          onSave={async (title) => {
            await usePlans.getState().rename(renaming.id, title);
            setRenaming(null);
          }}
        />
      )}
      <ConfirmDialog
        open={removing !== null}
        title={`Remove ${removing?.title ?? 'plan'}?`}
        confirmLabel="Remove"
        destructive
        onCancel={() => setRemoving(null)}
        onConfirm={() => {
          const target = removing;
          setRemoving(null);
          if (target) {
            void usePlans
              .getState()
              .remove(target.id)
              .catch((err: unknown) =>
                toast(`Could not remove: ${err instanceof Error ? err.message : String(err)}`),
              );
          }
        }}
      >
        It is deleted from this computer. The original file or artifact is not touched.
      </ConfirmDialog>
    </div>
  );
}

function RenameDialog({
  plan,
  onClose,
  onSave,
}: {
  plan: PlanSummary;
  onClose: () => void;
  onSave: (title: string) => Promise<void>;
}) {
  const [title, setTitle] = useState(plan.title);
  const [error, setError] = useState<string | null>(null);
  return (
    <Modal title="Rename plan" onClose={onClose} width="max-w-sm">
      <form
        className="flex flex-col gap-3 px-4 py-3 text-xs"
        onSubmit={(e) => {
          e.preventDefault();
          onSave(title).catch((err: unknown) =>
            setError(err instanceof Error ? err.message : String(err)),
          );
        }}
      >
        <label className="flex flex-col gap-1">
          <span className="text-fg-muted">Name</span>
          <input
            autoFocus
            value={title}
            maxLength={120}
            onChange={(e) => setTitle(e.target.value)}
            className="h-8 rounded-control border border-border bg-bg px-2 text-[13px] outline-none focus:border-border-strong"
          />
        </label>
        {error && (
          <p role="alert" className="text-danger">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary">
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
