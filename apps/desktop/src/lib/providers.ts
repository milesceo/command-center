import { MODEL_OPTIONS, type ProviderId, type ProviderInfo } from '@command-center/protocol';

/**
 * What the UI knows about each provider before (or without) asking the bridge: the display
 * name, how a user can sign in, and a plain-language limit. The bridge's `providers.report`
 * replaces this with live auth state; docs/providers.md has the research behind the wording.
 */
export interface ProviderMeta {
  id: ProviderId;
  name: string;
  /** One line shown on the onboarding card. */
  summary: string;
  /** The honest limit, shown under the summary. */
  limit: string;
  /** Command the user can run themselves to sign in (shown as a fallback). */
  loginCommand: string | null;
  /** True when an API key is a supported route for this provider. */
  supportsApiKey: boolean;
  /** True when signing in with a subscription is supported (via the official CLI). */
  supportsSubscription: boolean;
  /** Where to get a key, when one is supported. */
  keyHint: string | null;
}

export const PROVIDER_META: Readonly<Record<ProviderId, ProviderMeta>> = {
  claude: {
    id: 'claude',
    name: 'Claude',
    summary: 'Chat with Claude on your Claude subscription.',
    limit: 'Uses your Claude Code login. No API key is ever used.',
    loginCommand: 'claude auth login',
    supportsApiKey: false,
    supportsSubscription: true,
    keyHint: null,
  },
  openai: {
    id: 'openai',
    name: 'ChatGPT',
    summary: 'Use your ChatGPT plan through the official Codex CLI.',
    limit:
      'Needs the Codex CLI (npm i -g @openai/codex). Replies arrive as whole messages and tools stay off.',
    loginCommand: 'codex login',
    supportsApiKey: false,
    supportsSubscription: true,
    keyHint: null,
  },
  xai: {
    id: 'xai',
    name: 'Grok',
    summary: 'Use an xAI API key, or sign in through the official Grok CLI.',
    limit:
      'API key is the dependable route. The Grok CLI route is beta and returns plain text with no token counts.',
    loginCommand: 'grok login',
    supportsApiKey: true,
    supportsSubscription: true,
    keyHint: 'Create a key at console.x.ai.',
  },
};

export const providerName = (id: ProviderId): string => PROVIDER_META[id].name;

/** Models to offer for a provider when no live report is available. */
export function fallbackModels(id: ProviderId): { id: string; label: string }[] {
  if (id === 'claude') return MODEL_OPTIONS.map((m) => ({ id: m.id, label: m.label }));
  if (id === 'xai') {
    return [
      { id: 'default', label: 'Default' },
      { id: 'grok-4.7', label: 'Grok 4.7' },
    ];
  }
  return [{ id: 'default', label: 'Codex default' }];
}

export type ConnectionState = 'connected' | 'needs_signin' | 'not_installed' | 'unknown' | 'off';

/**
 * Collapses the bridge's auth state and whether a key is stored into one badge for the UI.
 * `method` is how the user chose to connect (null when they have not).
 */
export function connectionState(
  info: ProviderInfo | undefined,
  hasKey: boolean,
  method: 'subscription' | 'apiKey' | null,
): ConnectionState {
  if (method === 'apiKey') return hasKey ? 'connected' : 'needs_signin';
  if (!info) return method === null ? 'off' : 'unknown';
  if (info.auth === 'signed_in') return 'connected';
  if (info.auth === 'not_installed') return 'not_installed';
  if (info.auth === 'unknown') return method === null ? 'off' : 'unknown';
  return 'needs_signin';
}
