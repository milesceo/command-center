import { COST_LABEL, formatCost, formatTokens } from '../../lib/format';
import { totalTokens } from '../../lib/repo-usage';
import { useUsage } from '../../stores/usage';
import { useUiStore } from '../../stores/ui';

/** This conversation's running totals, for the chat header. */
export function ConversationUsage({ conversationId }: { conversationId: string }) {
  const totals = useUsage((s) => s.conversationTotals[conversationId]);
  if (!totals || totals.replies === 0) return null;

  const detail = [
    `${totals.replies} ${totals.replies === 1 ? 'reply' : 'replies'}`,
    `input ${formatTokens(totals.inputTokens)}`,
    `output ${formatTokens(totals.outputTokens)}`,
    `cache write ${formatTokens(totals.cacheCreationTokens)}`,
    `cache read ${formatTokens(totals.cacheReadTokens)}`,
    `${COST_LABEL} ${formatCost(totals.costUsd, totals.costComplete)} (informational, not a bill)`,
  ].join(' · ');

  return (
    <button
      type="button"
      title={detail}
      aria-label={`Conversation usage: ${detail}`}
      onClick={() => useUiStore.getState().setView('usage')}
      className="flex items-center gap-2 rounded-control px-2 py-0.5 text-[11px] text-fg-subtle tabular-nums hover:bg-hover hover:text-fg-muted"
      data-testid="conversation-usage"
    >
      <span>{formatTokens(totalTokens(totals))} tokens</span>
      {totals.costUsd !== null && (
        <span>· API-equiv. {formatCost(totals.costUsd, totals.costComplete)}</span>
      )}
    </button>
  );
}
