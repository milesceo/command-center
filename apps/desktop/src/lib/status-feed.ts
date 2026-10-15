import {
  STATUS_FEED_URL,
  feedProviderFor,
  parseStatusFeed,
  type FeedModel,
  type OverallStatus,
  type ProviderId,
  type StatusFeed,
} from '@geeked/protocol';

/**
 * The AI status feed: `latest.json` from engineerlish/geeked-ai-status, fetched on launch and
 * every 30 minutes, validated, cached locally, and read from the cache when offline.
 * Pure helpers live here; `stores/status.ts` owns the state and the timer.
 */

export const REFRESH_MS = 30 * 60_000;
const CACHE_KEY = 'geeked-status-feed';
const KNOWN_KEY = 'geeked-status-known-models';

// ----------------------------------------------------------------------------- cache

interface CacheEntry {
  /** Epoch ms the copy was fetched. */
  fetchedAt: number;
  feed: StatusFeed;
}

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Reads the last good copy. A damaged or outdated cache entry is ignored, never fatal. */
export function loadCachedFeed(): CacheEntry | null {
  try {
    const raw = storage()?.getItem(CACHE_KEY);
    if (!raw) return null;
    const entry = JSON.parse(raw) as { fetchedAt?: unknown; feed?: unknown };
    if (typeof entry.fetchedAt !== 'number') return null;
    const parsed = parseStatusFeed(entry.feed);
    return parsed.ok ? { fetchedAt: entry.fetchedAt, feed: parsed.value } : null;
  } catch {
    return null;
  }
}

export function saveCachedFeed(entry: CacheEntry): void {
  try {
    storage()?.setItem(CACHE_KEY, JSON.stringify(entry));
  } catch {
    // Storage full or blocked: the feed still works for this session.
  }
}

// ----------------------------------------------------------------------------- fetch

export type FetchFeedResult = { ok: true; feed: StatusFeed } | { ok: false; error: string };

/** Fetches and validates the feed. Never throws; a failure says why in plain words. */
export async function fetchFeed(
  fetchFn: typeof fetch = fetch,
  url: string = STATUS_FEED_URL,
  signal?: AbortSignal,
): Promise<FetchFeedResult> {
  try {
    const response = await fetchFn(url, {
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      ...(signal ? { signal } : {}),
    });
    if (!response.ok)
      return { ok: false, error: `The status feed returned HTTP ${response.status}.` };
    const parsed = parseStatusFeed(await response.json());
    return parsed.ok ? { ok: true, feed: parsed.value } : { ok: false, error: parsed.error };
  } catch (err) {
    return {
      ok: false,
      error:
        err instanceof Error
          ? `Could not reach the status feed (${err.message}).`
          : 'Could not reach the status feed.',
    };
  }
}

// ----------------------------------------------------------------------------- status

const PROVIDER_IDS_IN_FEED = ['claude', 'openai', 'xai'] as const;

export interface DotStyle {
  label: string;
  /** Tailwind background class from the design tokens. */
  className: string;
}

export const STATUS_DOT: Record<OverallStatus, DotStyle> = {
  operational: { label: 'Operational', className: 'bg-success' },
  degraded: { label: 'Degraded', className: 'bg-warning' },
  maintenance: { label: 'Maintenance', className: 'bg-warning' },
  partial_outage: { label: 'Partial outage', className: 'bg-danger' },
  major_outage: { label: 'Major outage', className: 'bg-danger' },
  unknown: { label: 'Status unknown', className: 'bg-fg-subtle' },
};

/** The status of one Geeked provider in a feed, or `unknown` when the feed has no entry for it. */
export function statusFor(feed: StatusFeed | null, provider: ProviderId): OverallStatus {
  if (!feed) return 'unknown';
  return feedProviderFor(feed, provider)?.status.overall ?? 'unknown';
}

// ----------------------------------------------------------------------------- new models

/** Models that are plainly not chat models (embeddings, speech, images...) are never announced. */
const NOT_CHAT =
  /embed|whisper|tts|dall-e|moderation|image|audio|realtime|transcribe|davinci|babbage|search|sora/i;

export const isChatModelId = (id: string): boolean => !NOT_CHAT.test(id);

export interface ModelNotice {
  provider: ProviderId;
  model: FeedModel;
}

/** What the app has already seen, per provider, plus the models it added to the picker. */
export interface KnownModels {
  seen: Partial<Record<ProviderId, string[]>>;
  added: Partial<Record<ProviderId, FeedModel[]>>;
  dismissed: string[];
}

export const emptyKnown = (): KnownModels => ({ seen: {}, added: {}, dismissed: [] });

export function loadKnown(): KnownModels {
  try {
    const raw = storage()?.getItem(KNOWN_KEY);
    if (!raw) return emptyKnown();
    const value = JSON.parse(raw) as Partial<KnownModels>;
    return {
      seen: typeof value.seen === 'object' && value.seen ? value.seen : {},
      added: typeof value.added === 'object' && value.added ? value.added : {},
      dismissed: Array.isArray(value.dismissed)
        ? value.dismissed.filter((d) => typeof d === 'string')
        : [],
    };
  } catch {
    return emptyKnown();
  }
}

export function saveKnown(known: KnownModels): void {
  try {
    storage()?.setItem(KNOWN_KEY, JSON.stringify(known));
  } catch {
    // See saveCachedFeed.
  }
}

export interface Detection {
  known: KnownModels;
  /** New models for connected providers this time (for notices). */
  announced: ModelNotice[];
  changed: boolean;
}

/**
 * Compares a feed against what has been seen. The first time a provider is ever seen its
 * models become the baseline silently (otherwise every launch would announce a catalog). After
 * that, a new chat-capable model id for a *connected* provider is announced once and added to
 * that provider's picker. Providers that are not connected only have their baseline advanced, so
 * connecting one later does not announce its whole catalog either.
 */
export function detectNewModels(
  feed: StatusFeed,
  known: KnownModels,
  connected: ReadonlySet<ProviderId>,
): Detection {
  const next: KnownModels = {
    seen: { ...known.seen },
    added: { ...known.added },
    dismissed: [...known.dismissed],
  };
  const announced: ModelNotice[] = [];
  let changed = false;

  for (const id of PROVIDER_IDS_IN_FEED) {
    const entry = feedProviderFor(feed, id);
    // Only a successful listing is trusted; a failed one carries stale data.
    if (!entry || entry.models.state !== 'ok') continue;
    const ids = entry.models.items.map((m) => m.id);
    const before = known.seen[id];

    if (before === undefined) {
      next.seen[id] = ids;
      changed = true;
      continue;
    }
    const beforeSet = new Set(before);
    const fresh = entry.models.items.filter((m) => !beforeSet.has(m.id));
    if (fresh.length === 0 && ids.length === before.length) continue;

    next.seen[id] = Array.from(new Set([...before, ...ids]));
    changed = true;

    if (!connected.has(id)) continue;
    const already = new Set((next.added[id] ?? []).map((m) => m.id));
    for (const model of fresh) {
      if (!isChatModelId(model.id) || already.has(model.id)) continue;
      next.added[id] = [...(next.added[id] ?? []), model];
      if (!next.dismissed.includes(`${id}:${model.id}`)) announced.push({ provider: id, model });
    }
  }
  return { known: next, announced, changed };
}

/** Picker entries for one provider: its own models plus the ones the feed announced. */
export function mergeModels(
  base: readonly { id: string; label: string }[],
  added: readonly FeedModel[] | undefined,
): { id: string; label: string }[] {
  const out = [...base];
  const have = new Set(out.map((m) => m.id));
  for (const model of added ?? []) {
    if (have.has(model.id)) continue;
    out.push({ id: model.id, label: model.display_name || model.id });
    have.add(model.id);
  }
  return out;
}

/** "5 min ago", "2 h ago", "3 days ago". */
export function ago(fromMs: number, nowMs: number = Date.now()): string {
  const minutes = Math.max(0, Math.round((nowMs - fromMs) / 60_000));
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} days ago`;
}
