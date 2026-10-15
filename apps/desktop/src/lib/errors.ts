import type { BridgeError } from '@geeked/protocol';

/** User-facing copy for a bridge error. The raw message is kept for a "details" disclosure. */
export interface FriendlyError {
  title: string;
  body: string;
  /** Technical text worth showing in a collapsible "details" area. */
  details?: string;
}

const LIMIT_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'weekly',
  seven_day_opus: 'weekly Opus',
  seven_day_sonnet: 'weekly Sonnet',
  seven_day_overage_included: 'weekly',
  overage: 'extra-usage',
};

const limitLabel = (type?: string) => (type ? LIMIT_LABELS[type] : undefined);

/** "2h 15m", "3d 4h", "45s": the two most significant units. */
export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const days = Math.floor(total / 86_400);
  const hours = Math.floor((total % 86_400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m`;
  return `${total}s`;
}

/** "3:40 PM (in 2h 15m)", prefixed with the weekday when it is not today. */
export function formatReset(resetsAt: number, now = Date.now()): string {
  const when = new Date(resetsAt);
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  const sameDay = when.toDateString() === new Date(now).toDateString();
  const day = sameDay ? '' : `${when.toLocaleDateString(undefined, { weekday: 'short' })} `;
  const remaining = resetsAt - now;
  return remaining > 0 ? `${day}${time} (in ${formatDuration(remaining)})` : `${day}${time}`;
}

export function describeError(error: BridgeError, now = Date.now()): FriendlyError {
  switch (error.code) {
    case 'auth_required':
      return {
        title: 'Not logged in to Claude',
        body: 'Geeked uses your Claude Code login. Open a terminal, run `claude`, sign in, then retry.',
      };
    case 'usage_limit': {
      const label = limitLabel(error.limitType);
      const what = label ? `your ${label} Claude usage limit` : 'your Claude usage limit';
      const reset = error.resetsAt
        ? `It resets at ${formatReset(error.resetsAt, now)}.`
        : 'Run `/usage` in Claude Code to see when it resets.';
      return { title: 'Usage limit reached', body: `You have hit ${what}. ${reset}` };
    }
    case 'rate_limited': {
      const reset = error.resetsAt
        ? ` Try again at ${formatReset(error.resetsAt, now)}.`
        : ' Try again in a moment.';
      return { title: 'Slow down a little', body: `Claude is rate limiting requests.${reset}` };
    }
    case 'overloaded':
      return {
        title: 'Claude is overloaded',
        body: 'The service is busy right now. Retry in a moment.',
      };
    case 'account':
      return {
        title: 'Account problem',
        body: 'Claude reported a problem with your account or plan. Check claude.ai for details.',
        details: error.message,
      };
    case 'model_not_found':
      return {
        title: 'Model unavailable',
        body: 'The selected model is not available on your plan. Pick another one in the chat settings.',
      };
    case 'invalid_request':
      return { title: 'Request rejected', body: error.message };
    case 'sdk_unavailable':
      return {
        title: "Couldn't start the Claude runtime",
        body: 'Make sure Node.js and Claude Code are installed, then restart Geeked.',
        details: error.message,
      };
    case 'busy':
      return { title: 'Already running', body: 'This chat is already generating a reply.' };
    default:
      return {
        title: 'Something went wrong',
        body: 'The request failed unexpectedly.',
        details: error.message,
      };
  }
}

/** One-line heads-up for a non-blocking usage warning, e.g. "5-hour usage at 90% · resets 3:40 PM (in 1h 5m)". */
export function describeUsageWarning(
  info: { limitType?: string; resetsAt?: number; utilization?: number },
  now = Date.now(),
): string {
  const label = limitLabel(info.limitType);
  const used = info.utilization === undefined ? '' : ` at ${Math.round(info.utilization * 100)}%`;
  const reset = info.resetsAt ? ` · resets ${formatReset(info.resetsAt, now)}` : '';
  return `${label ? `${label[0]?.toUpperCase()}${label.slice(1)} usage` : 'Usage'}${used || ' is getting high'}${reset}`;
}
