/**
 * Types and a validating parser for the `latest.json` published by
 * https://github.com/engineerlish/geeked-ai-status (schema version 1).
 *
 * The field names are the feed's own (snake_case) so the types mirror its `schema.json` one to
 * one and there is no mapping layer to drift. The app treats the feed as untrusted input: it is
 * parsed here, never used directly.
 */

export const STATUS_FEED_SCHEMA_VERSION = 1;

/** Where the app fetches the newest snapshot from. */
export const STATUS_FEED_URL =
  'https://raw.githubusercontent.com/engineerlish/geeked-ai-status/main/latest.json';
/** Human-facing history (the repository). */
export const STATUS_HISTORY_URL = 'https://github.com/engineerlish/geeked-ai-status';

export type OverallStatus =
  'operational' | 'degraded' | 'partial_outage' | 'major_outage' | 'maintenance' | 'unknown';

export const OVERALL_STATUSES: readonly OverallStatus[] = [
  'operational',
  'degraded',
  'partial_outage',
  'major_outage',
  'maintenance',
  'unknown',
];

export type FeedIncidentImpact =
  'none' | 'minor' | 'major' | 'critical' | 'maintenance' | 'unknown';

export interface FeedModel {
  id: string;
  display_name: string;
  created_at: string | null;
  /** UTC date (YYYY-MM-DD) the collector first saw the model. */
  first_seen: string;
  /** True when this entry was carried over because the provider's models call failed. */
  stale?: boolean;
}

export interface FeedIncident {
  id: string;
  title: string;
  status: string;
  impact: FeedIncidentImpact;
  url: string | null;
  started_at: string | null;
  updated_at: string | null;
}

export interface FeedProvider {
  id: string;
  name: string;
  vendor: string;
  /** The Geeked provider id this entry belongs to (`claude`, `openai`, `xai`), when it maps to one. */
  geeked_provider: string | null;
  models: {
    state: 'ok' | 'error' | 'unavailable';
    source: string;
    error: string | null;
    items: FeedModel[];
  };
  status: {
    state: 'ok' | 'error';
    source: string;
    page_url?: string | null;
    error: string | null;
    overall: OverallStatus;
    summary: string;
    incidents: FeedIncident[];
    affected_components: { name: string; status: string }[];
  };
}

export interface StatusFeed {
  schema_version: 1;
  checked_at: string;
  scheduled_for: string;
  run: {
    trigger: 'schedule' | 'workflow_dispatch' | 'local';
    late: boolean;
    late_seconds: number;
    missed_count: number;
    missed_slots: string[];
  };
  providers: Record<string, FeedProvider>;
}

export type FeedParseResult = { ok: true; value: StatusFeed } | { ok: false; error: string };

type Json = Record<string, unknown>;
const isObject = (v: unknown): v is Json =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const isString = (v: unknown): v is string => typeof v === 'string';
const nullableString = (v: unknown): v is string | null => v === null || typeof v === 'string';

const IMPACTS: readonly string[] = ['none', 'minor', 'major', 'critical', 'maintenance', 'unknown'];
const MODEL_STATES: readonly string[] = ['ok', 'error', 'unavailable'];
const TRIGGERS: readonly string[] = ['schedule', 'workflow_dispatch', 'local'];
const MAX_PROVIDERS = 20;
const MAX_MODELS = 2000;
const MAX_INCIDENTS = 100;

function parseModel(raw: unknown): FeedModel | null {
  if (!isObject(raw) || !isString(raw.id) || raw.id === '') return null;
  const model: FeedModel = {
    id: raw.id,
    display_name: isString(raw.display_name) ? raw.display_name : raw.id,
    created_at: nullableString(raw.created_at) ? raw.created_at : null,
    first_seen: isString(raw.first_seen) ? raw.first_seen : '',
  };
  if (raw.stale === true) model.stale = true;
  return model;
}

function parseIncident(raw: unknown): FeedIncident | null {
  if (!isObject(raw) || !isString(raw.id) || !isString(raw.title)) return null;
  return {
    id: raw.id,
    title: raw.title,
    status: isString(raw.status) ? raw.status : 'unknown',
    impact: IMPACTS.includes(raw.impact as string) ? (raw.impact as FeedIncidentImpact) : 'unknown',
    // Only web links are kept; anything else could not be opened safely anyway.
    url: isString(raw.url) && /^https?:\/\//i.test(raw.url) ? raw.url : null,
    started_at: nullableString(raw.started_at) ? raw.started_at : null,
    updated_at: nullableString(raw.updated_at) ? raw.updated_at : null,
  };
}

function parseProvider(raw: unknown): FeedProvider | null {
  if (!isObject(raw) || !isString(raw.id) || !isString(raw.name)) return null;
  const models = raw.models;
  const status = raw.status;
  if (!isObject(models) || !isObject(status)) return null;
  if (!MODEL_STATES.includes(models.state as string)) return null;
  if (status.state !== 'ok' && status.state !== 'error') return null;
  if (!OVERALL_STATUSES.includes(status.overall as OverallStatus)) return null;
  if (!Array.isArray(models.items) || !Array.isArray(status.incidents)) return null;

  const items = models.items.slice(0, MAX_MODELS).map(parseModel);
  const incidents = status.incidents.slice(0, MAX_INCIDENTS).map(parseIncident);
  const components = Array.isArray(status.affected_components) ? status.affected_components : [];

  return {
    id: raw.id,
    name: raw.name,
    vendor: isString(raw.vendor) ? raw.vendor : raw.name,
    geeked_provider: isString(raw.geeked_provider) ? raw.geeked_provider : null,
    models: {
      state: models.state as 'ok' | 'error' | 'unavailable',
      source: isString(models.source) ? models.source : '',
      error: nullableString(models.error) ? models.error : null,
      items: items.filter((m): m is FeedModel => m !== null),
    },
    status: {
      state: status.state,
      source: isString(status.source) ? status.source : '',
      page_url:
        isString(status.page_url) && /^https?:\/\//i.test(status.page_url) ? status.page_url : null,
      error: nullableString(status.error) ? status.error : null,
      overall: status.overall as OverallStatus,
      summary: isString(status.summary) ? status.summary : '',
      incidents: incidents.filter((i): i is FeedIncident => i !== null),
      affected_components: components
        .filter(
          (c): c is { name: string; status: string } =>
            isObject(c) && isString(c.name) && isString(c.status),
        )
        .map((c) => ({ name: c.name, status: c.status })),
    },
  };
}

/**
 * Validates a parsed `latest.json`. A snapshot with a newer `schema_version` is refused (the
 * app keeps its cached copy); a provider entry that is malformed is dropped, not fatal.
 */
export function parseStatusFeed(raw: unknown): FeedParseResult {
  if (!isObject(raw)) return { ok: false, error: 'The feed is not a JSON object.' };
  if (raw.schema_version !== STATUS_FEED_SCHEMA_VERSION) {
    return {
      ok: false,
      error: `Unsupported feed version ${String(raw.schema_version)}; this app reads version ${STATUS_FEED_SCHEMA_VERSION}.`,
    };
  }
  if (!isString(raw.checked_at) || Number.isNaN(Date.parse(raw.checked_at))) {
    return { ok: false, error: 'The feed has no valid checked_at time.' };
  }
  if (!isObject(raw.providers)) return { ok: false, error: 'The feed has no providers.' };

  const entries = Object.entries(raw.providers).slice(0, MAX_PROVIDERS);
  const providers: Record<string, FeedProvider> = {};
  for (const [key, value] of entries) {
    const parsed = parseProvider(value);
    if (parsed) providers[key] = parsed;
  }
  if (Object.keys(providers).length === 0) {
    return { ok: false, error: 'The feed has no readable providers.' };
  }

  const run = isObject(raw.run) ? raw.run : {};
  return {
    ok: true,
    value: {
      schema_version: 1,
      checked_at: raw.checked_at,
      scheduled_for: isString(raw.scheduled_for) ? raw.scheduled_for : raw.checked_at,
      run: {
        trigger: TRIGGERS.includes(run.trigger as string)
          ? (run.trigger as StatusFeed['run']['trigger'])
          : 'local',
        late: run.late === true,
        late_seconds: typeof run.late_seconds === 'number' ? run.late_seconds : 0,
        missed_count: typeof run.missed_count === 'number' ? run.missed_count : 0,
        missed_slots: Array.isArray(run.missed_slots) ? run.missed_slots.filter(isString) : [],
      },
      providers,
    },
  };
}

/** Looks up a feed entry by the Geeked provider id (`claude`, `openai`, `xai`). */
export function feedProviderFor(feed: StatusFeed, geekedId: string): FeedProvider | null {
  return Object.values(feed.providers).find((p) => p.geeked_provider === geekedId) ?? null;
}
