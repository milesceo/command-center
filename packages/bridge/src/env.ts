/**
 * The bridge's own environment variables. They are named `COMMAND_CENTER_*`; for one release the
 * names from before the rename (`GEEKED_*`) still work, with a warning on stderr, so existing
 * scripts keep running. Remove the fallback in the release after next. With the migration code
 * this is one of the few places the old name may appear.
 */
const PREFIX = 'COMMAND_CENTER_';
const LEGACY_PREFIX = 'GEEKED_';

const warned = new Set<string>();

/**
 * Reads `COMMAND_CENTER_<name>`, falling back to the deprecated `GEEKED_<name>`. An empty or
 * whitespace-only value counts as unset.
 */
export function appEnv(
  name: string,
  env: NodeJS.ProcessEnv = process.env,
  warn: (message: string) => void = (m) => process.stderr.write(`${m}\n`),
): string | undefined {
  const current = env[`${PREFIX}${name}`];
  if (current !== undefined && current.trim() !== '') return current;
  const legacy = env[`${LEGACY_PREFIX}${name}`];
  if (legacy === undefined || legacy.trim() === '') return undefined;
  if (!warned.has(name)) {
    warned.add(name);
    warn(
      `[bridge] ${LEGACY_PREFIX}${name} is deprecated and will stop working in a future release; use ${PREFIX}${name}.`,
    );
  }
  return legacy;
}

/** Test hook: forget which deprecation warnings were already printed. */
export function resetEnvWarnings(): void {
  warned.clear();
}
