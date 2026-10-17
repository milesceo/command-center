// Fails when one of the app's former names appears anywhere it should not. The app was called
// programish, then Geeked, and is now Command Center. The old names may live in the CHANGELOG
// (history), the saved session prompts (kept verbatim; not the folder's README), and the migration and legacy code that
// has to know them. Two kinds of reference are allowed everywhere: the upstream repository's URL
// (`engineerlish/geeked`), and the AI status feed (`engineerlish/geeked-ai-status`, a separate
// repository this app reads but does not own), whose schema names one field `geeked_provider`.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OLD_NAMES = ['programish', 'geeked'];
const ALLOWED_FILES = new Set([
  'CHANGELOG.md',
  'scripts/check-name.mjs',
  'apps/desktop/src-tauri/src/migrate.rs',
  'apps/desktop/src-tauri/src/legacy_keys.rs',
  'apps/desktop/src-tauri/src/env.rs',
  'apps/desktop/src/lib/legacy.ts',
  'apps/desktop/src/lib/legacy.test.ts',
  'packages/bridge/src/env.ts',
  'packages/bridge/src/env.test.ts',
]);
/** Saved session prompts, kept verbatim (not the folder's README). */
const ALLOWED_DIRS = [/^docs\/prompts\/\d{4}-\d{2}-\d{2}-[\w.-]+\.md$/];
/** Removed from each line before searching, so only stray uses are left. */
const ALLOWED_REFERENCES = [
  /engineerlish\/programish(?![\w-])/gi,
  /engineerlish\/geeked-ai-status(?![\w-])/gi,
  /engineerlish\/geeked(?![\w-])/gi,
  /\bgeeked_provider\b/g,
];

// Tracked files plus new ones not yet added, so a stray name is caught before it is staged.
const files = execFileSync(
  'git',
  ['ls-files', '-z', '--cached', '--others', '--exclude-standard'],
  {
    encoding: 'utf8',
  },
)
  .split('\0')
  .filter(
    (f) =>
      f &&
      !ALLOWED_FILES.has(f) &&
      !ALLOWED_DIRS.some((dir) => dir.test(f)) &&
      !/\.(png|ico|icns|woff2?)$/i.test(f),
  );

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const name = file.toLowerCase();
  if (OLD_NAMES.some((old) => name.includes(old))) hits.push(`${file} (file name)`);
  text.split('\n').forEach((line, i) => {
    const rest = ALLOWED_REFERENCES.reduce((l, re) => l.replace(re, ''), line).toLowerCase();
    if (OLD_NAMES.some((old) => rest.includes(old))) hits.push(`${file}:${i + 1}`);
  });
}

if (hits.length > 0) {
  console.error(`A former app name is still used in:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('check-name: no stray references to the former names.');
