import { X } from 'lucide-react';
import { providerName } from '../../lib/providers';
import { useStatus } from '../../stores/status';

const MAX_VISIBLE = 3;

/**
 * Dismissible notices for models that appeared for a connected provider. The model has already
 * been added to that provider's picker by the time the notice shows.
 */
export function ModelNotices() {
  const notices = useStatus((s) => s.notices);
  const dismiss = useStatus((s) => s.dismiss);
  if (notices.length === 0) return null;

  const visible = notices.slice(0, MAX_VISIBLE);
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-10 z-50 flex w-80 flex-col gap-2"
      data-testid="model-notices"
    >
      {visible.map((notice) => (
        <div
          key={`${notice.provider}:${notice.model.id}`}
          role="status"
          className="pointer-events-auto flex items-start gap-2 rounded-panel border border-border-strong bg-elevated p-3 text-[12px] shadow-xl"
        >
          <div className="min-w-0 flex-1">
            <p className="font-medium">New {providerName(notice.provider)} model</p>
            <p className="mt-0.5 truncate text-fg-muted" title={notice.model.id}>
              {notice.model.display_name || notice.model.id}
            </p>
            <p className="mt-0.5 text-[11px] text-fg-subtle">Added to the model picker.</p>
          </div>
          <button
            type="button"
            aria-label={`Dismiss the ${notice.model.display_name || notice.model.id} notice`}
            onClick={() => dismiss(notice.provider, notice.model.id)}
            className="grid size-6 shrink-0 place-items-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
          >
            <X size={13} aria-hidden="true" />
          </button>
        </div>
      ))}
      {notices.length > MAX_VISIBLE && (
        <p className="pointer-events-auto self-end rounded-control bg-elevated px-2 py-1 text-[11px] text-fg-subtle">
          +{notices.length - MAX_VISIBLE} more
        </p>
      )}
    </div>
  );
}
