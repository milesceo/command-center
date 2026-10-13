import type {
  Options,
  SDKControlGetUsageResponse,
  SDKMessage,
} from '@anthropic-ai/claude-agent-sdk';

/** The slice of the SDK's `query` we depend on; tests and the e2e harness substitute their own. */
export type QueryFn = (params: {
  prompt: string | AsyncIterable<never>;
  options?: Options;
}) => AsyncIterable<SDKMessage> & {
  /** Experimental control request behind `/usage`: plan windows when the login has them. */
  usage_EXPERIMENTAL_MAY_CHANGE_DO_NOT_RELY_ON_THIS_API_YET?: (opts?: {
    skipBehaviors?: boolean;
  }) => Promise<SDKControlGetUsageResponse>;
};

/**
 * Loads the SDK lazily so `ping` stays instant and a missing/broken install
 * becomes a reportable `sdk_unavailable` error instead of a crash at startup.
 *
 * `PROGRAMISH_QUERY_MODULE` points at a module exporting `query`; it exists so
 * the end-to-end harness can run the real bridge process without a Claude login.
 */
export async function loadQuery(): Promise<QueryFn> {
  const specifier = process.env.PROGRAMISH_QUERY_MODULE ?? '@anthropic-ai/claude-agent-sdk';
  const mod = (await import(specifier)) as { query?: QueryFn };
  if (typeof mod.query !== 'function')
    throw new Error(`Module ${specifier} does not export query().`);
  return mod.query;
}
