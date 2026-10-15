import { isAbsolute } from 'node:path';
import { pathToFileURL } from 'node:url';
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
 * `GEEKED_QUERY_MODULE` points at a module exporting `query`; it exists so
 * the end-to-end harness can run the real bridge process without a Claude login.
 */
/**
 * `import()` takes URLs, and on Windows a path like `D:\\a\\fake-sdk.mjs` reads as a URL with the
 * scheme `d:` and fails. Absolute filesystem paths become file URLs; package names pass through.
 */
export function moduleSpecifier(specifier: string): string {
  return isAbsolute(specifier) || /^[A-Za-z]:[\\/]/.test(specifier)
    ? pathToFileURL(specifier).href
    : specifier;
}

export async function loadQuery(): Promise<QueryFn> {
  const override = process.env.GEEKED_QUERY_MODULE;
  // A literal specifier (not a variable) so the release build can bundle the SDK into main.mjs.
  const mod = (await (override
    ? import(moduleSpecifier(override))
    : import('@anthropic-ai/claude-agent-sdk'))) as {
    query?: QueryFn;
  };
  if (typeof mod.query !== 'function')
    throw new Error(
      `Module ${override ?? '@anthropic-ai/claude-agent-sdk'} does not export query().`,
    );
  return mod.query;
}

/**
 * The Claude runtime binary to launch. The installed app ships the one that matches the
 * SDK version and tells the bridge where it is; in development this is unset and the SDK
 * finds its own copy in node_modules.
 */
export function claudeExecutable(base: NodeJS.ProcessEnv = process.env): string | undefined {
  const path = base.GEEKED_CLAUDE_EXECUTABLE?.trim();
  return path ? path : undefined;
}
