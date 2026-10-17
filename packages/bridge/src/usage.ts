import type {
  SDKControlGetUsageResponse,
  SDKRateLimitInfo,
  SDKResultMessage,
} from '@anthropic-ai/claude-agent-sdk';
import type {
  ChatUsage,
  ExtraUsage,
  ModelUsageEntry,
  UsageReportEvent,
  UsageWindow,
} from '@command-center/protocol';
import { normalizeResetsAt } from './errors';

/**
 * Token and cost accounting, plus plan-window mapping.
 *
 * Everything here is informational. Tokens come straight from the SDK's result;
 * cost is whatever the SDK reports as the API-equivalent price (the account is a
 * subscription, so it is not a bill). Nothing is estimated or guessed: a figure the
 * SDK does not provide stays absent.
 */

const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);

/**
 * Usage of one finished query. `modelUsage` is preferred because it covers every
 * model the query used (sub-agents, helper calls) with its own cost; `usage` only
 * covers the main loop and is the fallback.
 */
export function usageFromResult(
  result: SDKResultMessage,
  fallbackModel: string | undefined,
): ChatUsage {
  const byModel = Object.entries(result.modelUsage ?? {});
  if (byModel.length > 0) {
    const models: ModelUsageEntry[] = byModel.map(([model, u]) => {
      const entry: ModelUsageEntry = {
        model,
        inputTokens: u.inputTokens,
        outputTokens: u.outputTokens,
        cacheReadTokens: u.cacheReadInputTokens,
        cacheCreationTokens: u.cacheCreationInputTokens,
      };
      // 'unknown' means the SDK had no price for the model and used a guess: leave the cost out.
      if (Number.isFinite(u.costUSD) && u.costBasis !== 'unknown') entry.costUsd = u.costUSD;
      return entry;
    });
    const usage: ChatUsage = {
      inputTokens: sum(models.map((m) => m.inputTokens)),
      outputTokens: sum(models.map((m) => m.outputTokens)),
      cacheReadTokens: sum(models.map((m) => m.cacheReadTokens)),
      cacheCreationTokens: sum(models.map((m) => m.cacheCreationTokens)),
      models,
    };
    const costs = models.map((m) => m.costUsd);
    if (costs.every((c): c is number => c !== undefined)) usage.costUsd = sum(costs);
    return usage;
  }

  const u = result.usage;
  const counts = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
    cacheReadTokens: u.cache_read_input_tokens ?? 0,
    cacheCreationTokens: u.cache_creation_input_tokens ?? 0,
  };
  const entry: ModelUsageEntry = { model: fallbackModel ?? 'unknown', ...counts };
  const usage: ChatUsage = { ...counts, models: [entry] };
  if (Number.isFinite(result.total_cost_usd)) {
    usage.costUsd = result.total_cost_usd;
    entry.costUsd = result.total_cost_usd;
  }
  return usage;
}

const WINDOW_LABELS: Record<string, string> = {
  five_hour: '5-hour',
  seven_day: 'Weekly',
  seven_day_opus: 'Weekly (Opus)',
  seven_day_sonnet: 'Weekly (Sonnet)',
  seven_day_oauth_apps: 'Weekly (connected apps)',
};

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Plan windows from a `rate_limit_event`. The SDK's typed fields only describe the
 * window that triggered the event; the runtime also attaches a `unifiedWindows`
 * map (observed on 0.3.x, not in the type definitions), with utilization as a
 * fraction and reset times in unix seconds. It is read defensively: anything that
 * does not look right is ignored.
 */
export function windowsFromRateLimitInfo(info: SDKRateLimitInfo): UsageWindow[] {
  const unified = (info as { unifiedWindows?: unknown }).unifiedWindows;
  if (typeof unified !== 'object' || unified === null) return [];
  const windows: UsageWindow[] = [];
  for (const [key, raw] of Object.entries(unified)) {
    if (typeof raw !== 'object' || raw === null) continue;
    const { utilization, resetsAt } = raw as { utilization?: unknown; resetsAt?: unknown };
    windows.push({
      key,
      label: WINDOW_LABELS[key] ?? key.replace(/_/g, ' '),
      utilization:
        typeof utilization === 'number' && Number.isFinite(utilization)
          ? clamp01(utilization)
          : null,
      resetsAt: typeof resetsAt === 'number' ? (normalizeResetsAt(resetsAt) ?? null) : null,
    });
  }
  return windows;
}

type PlanWindow = { utilization: number | null; resets_at: string | null } | null | undefined;

function fromPlanWindow(key: string, label: string, raw: PlanWindow): UsageWindow | null {
  if (!raw) return null;
  const time = raw.resets_at ? Date.parse(raw.resets_at) : Number.NaN;
  return {
    key,
    label,
    // The control API reports percent (0-100); the app works in fractions.
    utilization: raw.utilization === null ? null : clamp01(raw.utilization / 100),
    resetsAt: Number.isFinite(time) ? time : null,
  };
}

/** Maps the SDK's experimental `/usage` data to the protocol report. */
export function reportFromUsage(
  id: string,
  response: SDKControlGetUsageResponse,
): UsageReportEvent {
  const limits = response.rate_limits;
  if (!response.rate_limits_available || !limits) {
    return {
      type: 'usage.report',
      id,
      available: false,
      subscriptionType: response.subscription_type,
      windows: [],
      extraUsage: null,
    };
  }
  const windows: UsageWindow[] = [
    fromPlanWindow('five_hour', WINDOW_LABELS.five_hour as string, limits.five_hour),
    fromPlanWindow('seven_day', WINDOW_LABELS.seven_day as string, limits.seven_day),
    fromPlanWindow('seven_day_opus', WINDOW_LABELS.seven_day_opus as string, limits.seven_day_opus),
    fromPlanWindow(
      'seven_day_sonnet',
      WINDOW_LABELS.seven_day_sonnet as string,
      limits.seven_day_sonnet,
    ),
    fromPlanWindow(
      'seven_day_oauth_apps',
      WINDOW_LABELS.seven_day_oauth_apps as string,
      limits.seven_day_oauth_apps,
    ),
    ...(limits.model_scoped ?? []).map((m) =>
      fromPlanWindow(`model:${m.display_name}`, `Weekly (${m.display_name})`, {
        utilization: m.utilization,
        resets_at: m.resets_at,
      }),
    ),
  ].filter((w): w is UsageWindow => w !== null);

  const extra = limits.extra_usage;
  const extraUsage: ExtraUsage | null = extra
    ? {
        enabled: extra.is_enabled,
        usedCredits: extra.used_credits,
        monthlyLimit: extra.monthly_limit,
        utilization: extra.utilization === null ? null : clamp01(extra.utilization / 100),
        currency: extra.currency ?? null,
      }
    : null;
  return {
    type: 'usage.report',
    id,
    available: true,
    subscriptionType: response.subscription_type,
    windows,
    extraUsage,
  };
}
