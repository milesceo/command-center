import { DEFAULT_PROVIDER, type ProviderId, type ProviderInfo } from '@command-center/protocol';
import { claudeProvider } from './claude';
import { codexProvider } from './codex';
import { grokProvider } from './grok';
import { huggingfaceProvider } from './huggingface';
import { localProvider } from './local';
import type { Provider, ProviderContext } from './types';

/** Every provider the bridge knows, keyed by id. Add new adapters here. */
export function createRegistry(extra: readonly Provider[] = []): ReadonlyMap<ProviderId, Provider> {
  const all: Provider[] = [
    claudeProvider,
    codexProvider,
    grokProvider,
    huggingfaceProvider,
    localProvider,
    ...extra,
  ];
  return new Map(all.map((p) => [p.id, p]));
}

export function providerFor(
  registry: ReadonlyMap<ProviderId, Provider>,
  id: ProviderId | undefined,
): Provider {
  const found = registry.get(id ?? DEFAULT_PROVIDER);
  if (!found) throw new Error(`No adapter for provider ${String(id)}.`);
  return found;
}

/** What `providers.report` carries: each provider's identity, routes, models and auth state. */
export async function describeProviders(
  registry: ReadonlyMap<ProviderId, Provider>,
  ctx: ProviderContext,
  hasKey: readonly ProviderId[] = [],
): Promise<ProviderInfo[]> {
  return Promise.all(
    [...registry.values()].map(async (provider): Promise<ProviderInfo> => {
      let auth;
      try {
        auth = await provider.authStatus(ctx, hasKey.includes(provider.id));
      } catch {
        auth = { state: 'unknown' as const };
      }
      return {
        id: provider.id,
        name: provider.displayName,
        authMethods: [...provider.authMethods],
        auth: auth.state,
        ...(auth.via ? { authVia: auth.via } : {}),
        models: provider.models(),
        note: provider.note,
        ...(auth.runtimes ? { runtimes: auth.runtimes } : {}),
      };
    }),
  );
}
