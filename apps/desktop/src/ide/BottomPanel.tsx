import { X } from 'lucide-react';
import { COST_LABEL, formatCost, formatTokens } from '../lib/format';
import { useChat } from '../stores/chat';
import { useIdeStore } from '../stores/ide';
import { useTurns } from './shared/hooks';
import { firstLine } from './shared/threads';

/** Per-reply ledger of the open thread: model, tokens, cost and status, from stored messages. */
export function BottomPanel({ height }: { height: number }) {
  const turns = useTurns();
  const streaming = useChat((s) => Object.keys(s.streams).length > 0);
  const replies = turns.filter((t) => t.assistant);

  return (
    <section
      aria-label="Activity"
      className="flex shrink-0 flex-col overflow-hidden rounded-panel border border-border bg-surface"
      style={{ height }}
    >
      <div className="flex h-9 shrink-0 items-center gap-3 border-b border-border px-3">
        <h2 className="text-xs font-medium">Activity</h2>
        <span className="text-[11px] text-fg-subtle">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
          {streaming && ' · streaming'}
        </span>
        <button
          type="button"
          aria-label="Close activity panel"
          onClick={() => useIdeStore.getState().toggleBottom()}
          className="ml-auto grid size-6 place-items-center rounded-control text-fg-muted hover:bg-hover hover:text-fg"
        >
          <X size={13} />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-auto">
        {replies.length === 0 ? (
          <p className="p-4 text-xs text-fg-subtle">
            Replies in this thread appear here with their usage.
          </p>
        ) : (
          <table className="w-full border-collapse text-xs tabular-nums">
            <thead className="sticky top-0 bg-surface text-left text-[10px] tracking-wider text-fg-subtle uppercase">
              <tr>
                <th className="px-3 py-1.5 font-medium">#</th>
                <th className="px-3 py-1.5 font-medium">Prompt</th>
                <th className="px-3 py-1.5 font-medium">Model</th>
                <th className="px-3 py-1.5 text-right font-medium">Input</th>
                <th className="px-3 py-1.5 text-right font-medium">Output</th>
                <th className="px-3 py-1.5 text-right font-medium">Cache read</th>
                <th className="px-3 py-1.5 text-right font-medium">Cache write</th>
                <th className="px-3 py-1.5 text-right font-medium" title={COST_LABEL}>
                  API-equiv.
                </th>
                <th className="px-3 py-1.5 font-medium">Status</th>
              </tr>
            </thead>
            <tbody>
              {replies.map((t) => {
                const a = t.assistant;
                if (!a) return null;
                return (
                  <tr key={a.id} className="border-t border-border hover:bg-hover">
                    <td className="px-3 py-1.5 text-fg-subtle">{t.index + 1}</td>
                    <td className="max-w-64 truncate px-3 py-1.5">
                      {firstLine(t.user.content, 60)}
                    </td>
                    <td className="px-3 py-1.5 text-fg-muted">
                      {a.model?.replace(/^claude-/, '') ?? '—'}
                    </td>
                    <td className="px-3 py-1.5 text-right">{formatTokens(a.inputTokens ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right">{formatTokens(a.outputTokens ?? 0)}</td>
                    <td className="px-3 py-1.5 text-right">
                      {formatTokens(a.cacheReadTokens ?? 0)}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      {formatTokens(a.cacheCreationTokens ?? 0)}
                    </td>
                    <td className="px-3 py-1.5 text-right">{formatCost(a.costUsd)}</td>
                    <td className="px-3 py-1.5 text-fg-muted">{a.status}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}
