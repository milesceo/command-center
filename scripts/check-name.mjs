// Fails when the app's former name appears anywhere it should not. The old name may live in the
// CHANGELOG (history) and the migration code that has to know it; repository URLs keep it until
// the GitHub repository itself is renamed.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const OLD = 'programish';
const ALLOWED_FILES = new Set([
  'CHANGELOG.md',
  'pnpm-lock.yaml',
  'scripts/check-name.mjs',
  'apps/desktop/src-tauri/src/migrate.rs',
  'apps/desktop/src/lib/legacy.ts',
  'apps/desktop/src/lib/legacy.test.ts',
]);
const REPO_URL = /engineerlish\/programish/gi;

const files = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' })
  .split('\0')
  .filter((f) => f && !ALLOWED_FILES.has(f) && !/\.(png|ico|icns|woff2?)$/i.test(f));

const hits = [];
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    continue;
  }
  const name = file.toLowerCase();
  if (name.includes(OLD)) hits.push(`${file} (file name)`);
  text.split('\n').forEach((line, i) => {
    if (line.replace(REPO_URL, '').toLowerCase().includes(OLD)) hits.push(`${file}:${i + 1}`);
  });
}

if (hits.length > 0) {
  console.error(`The former app name is still used in:\n  ${hits.join('\n  ')}`);
  process.exit(1);
}
console.log('check-name: no stray references to the former name.');
