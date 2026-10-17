import type { SDKAssistantMessageError, SDKRateLimitInfo } from '@anthropic-ai/claude-agent-sdk';
import type { BridgeError } from '@command-center/protocol';

/**
 * The runtime reports reset times as unix timestamps; depending on the source
 * they have been seconds. Normalize to epoch milliseconds so the UI never
 * shows "resets in 55 years".
 */
export function normalizeResetsAt(value: number | undefined): number | undefined {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return undefined;
  return value < 1e12 ? Math.round(value * 1000) : Math.round(value);
}

function withLimit(error: BridgeError, limit: SDKRateLimitInfo | undefined): BridgeError {
  const resetsAt = normalizeResetsAt(limit?.resetsAt);
  if (resetsAt !== undefined) error.resetsAt = resetsAt;
  if (limit?.rateLimitType) error.limitType = limit.rateLimitType;
  return error;
}

/** Map the runtime's categorized assistant error (plus latest rate-limit info) to a protocol error. */
export function fromAssistantError(
  kind: SDKAssistantMessageError,
  limit?: SDKRateLimitInfo,
): BridgeError {
  switch (kind) {
    case 'authentication_failed':
      return {
        code: 'auth_required',
        message: 'Claude Code is not logged in or the login expired.',
      };
    case 'oauth_org_not_allowed':
    case 'account_on_hold':
    case 'verification_required':
    case 'billing_error':
    case 'cloud_credential_error':
      return { code: 'account', message: `Account problem reported by Claude Code: ${kind}.` };
    case 'rate_limit':
      // A rejected subscription window is a usage limit (wait until reset);
      // otherwise it is ordinary request throttling that clears on retry.
      return limit?.status === 'rejected'
        ? withLimit({ code: 'usage_limit', message: 'Subscription usage limit reached.' }, limit)
        : withLimit({ code: 'rate_limited', message: 'Rate limited by the API.' }, limit);
    case 'overloaded':
      return { code: 'overloaded', message: 'The API is overloaded.' };
    case 'model_not_found':
      return { code: 'model_not_found', message: 'The selected model is not available.' };
    case 'invalid_request':
      return { code: 'invalid_request', message: 'The request was rejected as invalid.' };
    case 'max_output_tokens':
      return { code: 'internal', message: 'The response hit the maximum output length.' };
    case 'server_error':
    case 'unknown':
      return { code: 'internal', message: `Claude Code reported an error: ${kind}.` };
  }
}

const AUTH =
  /not logged in|\/login|log in|authenticat|unauthorized|\b401\b|invalid api key|oauth|credential/i;
const USAGE = /usage limit|limit reached|5-hour|five.hour|weekly limit/i;
const MISSING = /ENOENT|not found|cannot find|failed to spawn|executable/i;

/**
 * Classify an exception or free-text failure. This is a best-effort fallback
 * for failures that never became a structured assistant error (for example the
 * runtime process exiting immediately); `detail` is the process stderr tail.
 */
export function fromFailureText(text: string, limit?: SDKRateLimitInfo): BridgeError {
  const message = text.trim() || 'Unknown error.';
  if (AUTH.test(message)) {
    return { code: 'auth_required', message: 'Claude Code is not logged in or the login expired.' };
  }
  if (USAGE.test(message) || limit?.status === 'rejected') {
    return withLimit({ code: 'usage_limit', message }, limit);
  }
  if (MISSING.test(message)) return { code: 'sdk_unavailable', message };
  return { code: 'internal', message };
}

export function fromThrown(err: unknown, stderrTail = '', limit?: SDKRateLimitInfo): BridgeError {
  const text = err instanceof Error ? err.message : String(err);
  // The thrown message for a crashed process is generic; stderr has the real reason.
  return fromFailureText(stderrTail ? `${text}\n${stderrTail}` : text, limit);
}
