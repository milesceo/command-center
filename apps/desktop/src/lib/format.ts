/** The only name under which a dollar figure is shown: it is what the SDK says the tokens would cost on the pay-as-you-go API, not a bill. */
export const COST_LABEL = 'API-equivalent cost';
export const COST_NOTE =
  'What these tokens would cost at pay-as-you-go API prices, as reported by the SDK. You are on a subscription, so this is informational, not a bill.';

/** 842 / 12.4k / 3.1M. */
export function formatTokens(n: number): string {
  if (n < 1000) return String(Math.round(n));
  if (n < 1_000_000) return `${trim(n / 1000, n < 10_000 ? 2 : n < 100_000 ? 1 : 0)}k`;
  return `${trim(n / 1_000_000, n < 10_000_000 ? 2 : 1)}M`;
}

const trim = (n: number, digits: number) => n.toFixed(digits).replace(/\.?0+$/, '');

/** $12.34, $0.12, or four significant decimals for sub-cent amounts ($0.0003). */
export function formatUsd(n: number): string {
  if (n === 0) return '$0.00';
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n >= 0.01) return `$${n.toFixed(2)}`;
  if (n >= 0.0001) return `$${n.toFixed(4)}`;
  return '<$0.0001';
}

/** Cost for display with its label semantics: "—" when the SDK reported none, "≥" when only some replies had one. */
export function formatCost(costUsd: number | null, complete = true): string {
  if (costUsd === null) return '—';
  return `${complete ? '' : '≥ '}${formatUsd(costUsd)}`;
}

export function formatPercent(fraction: number): string {
  return `${Math.round(fraction * 100)}%`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago". */
export function formatAgo(thenMs: number, nowMs = Date.now()): string {
  const seconds = Math.max(0, Math.round((nowMs - thenMs) / 1000));
  if (seconds < 45) return 'just now';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}
