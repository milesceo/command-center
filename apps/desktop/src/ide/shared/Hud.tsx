import { useEffect, type ReactNode } from 'react';
import { cn } from '../../lib/cn';
import { COST_LABEL, formatCost, formatPercent, formatTokens } from '../../lib/format';
import { totalTokens } from '../../lib/repo-usage';
import { headroom, sortWindows } from '../../lib/usage-windows';
import { useBridgeStore } from '../../stores/bridge';
import { useChat } from '../../stores/chat';
import { useActiveSettings, useConversations } from '../../stores/conversations';
import { usageStore, useUsage } from '../../stores/usage';

/** Window size used for the context-fill estimate; the SDK does not report the real one per model. */
const CONTEXT_WINDOW = 200_000;

/**
 * One-line status strip: bridge, model, context fill, thread usage and plan headroom.
 * Everything is read from data the app already stores; context fill is an estimate
 * from the last reply's input and cache tokens.
 */
export function Hud({ className, children }: { className?: string; children?: ReactNode }) {
  const status = useBridgeStore((s) => s.status);
  const settings = useActiveSettings();
  const activeId = useConversations((s) => s.activeId);
  const messages = useChat((s) => s.messages);
  const totals = useUsage((s) => (activeId ? s.conversationTotals[activeId] : undefined));
  const windows = useUsage((s) => s.data?.windows);
  const loaded = useUsage((s) => s.data !== null);

  useEffect(() => {
    if (!loaded) void usageStore.getState().load();
  }, [loaded]);

  const lastTokens = [...messages]
    .reverse()
    .find((m) => m.role === 'assistant' && m.inputTokens !== null);
  const used =
    (lastTokens?.inputTokens ?? 0) +
    (lastTokens?.cacheReadTokens ?? 0) +
    (lastTokens?.cacheCreationTokens ?? 0);
  const fill = lastTokens ? Math.min(1, used / CONTEXT_WINDOW) : null;

  const plan = windows && windows.length > 0 ? headroom(sortWindows(windows)[0]!) : null;
  const dot = status === 'ready' ? 'bg-success' : status === 'error' ? 'bg-danger' : 'bg-fg-subtle';

  return (
    <div
      className={cn(
        'flex h-7 shrink-0 items-center gap-3 border-t border-border bg-surface px-3 text-[11px] text-fg-subtle tabular-nums',
        className,
      )}
      data-testid="hud"
    >
      <span className="flex items-center gap-1.5" title={`Bridge: ${status}`}>
        <span className={cn('size-1.5 rounded-full', dot)} />
        {settings.model ?? 'default model'}
      </span>
      <span
        className="flex items-center gap-1.5"
        title={`Context fill, estimated from the last reply's input and cache tokens against a ${formatTokens(CONTEXT_WINDOW)} window`}
      >
        ctx
        <span className="h-1 w-16 overflow-hidden rounded-full bg-hover">
          <span
            className={cn(
              'block h-full rounded-full',
              fill !== null && fill > 0.8 ? 'bg-warning' : 'bg-accent',
            )}
            style={{ width: `${Math.round((fill ?? 0) * 100)}%` }}
          />
        </span>
        {fill === null ? '—' : `≈${formatPercent(fill)}`}
      </span>
      {totals && totals.replies > 0 && (
        <span title={`${COST_LABEL}, informational and not a bill`}>
          thread {formatTokens(totalTokens(totals))} tok ·{' '}
          {formatCost(totals.costUsd, totals.costComplete)}
        </span>
      )}
      {children}
      <span className="ml-auto" />
      {plan?.remaining != null && (
        <span
          title={`${plan.window.label} window as reported by the SDK`}
          className={cn(plan.severity !== 'ok' && 'text-warning')}
        >
          {plan.window.label} {formatPercent(plan.remaining)} left
        </span>
      )}
      <span className="hidden sm:inline">Mod+K palette</span>
    </div>
  );
}
