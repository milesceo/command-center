// Runs scripts/check-name.mjs as a child process inside a throwaway git repository, so the real
// repository is never read or changed. The former names are assembled at run time: this file is
// not on the guard's allow list, and spelling them out would make the guard fail on its own test.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'check-name.mjs');
const SECOND = 'gee' + 'ked';
const FIRST = 'program' + 'ish';

// A clean environment: no GIT_DIR/GIT_WORK_TREE from the caller can point git at the real repo.
const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith('GIT_')));

/** A fresh repo with `files` written (`add: false` leaves them untracked) and the guard's result. */
function run(files, { tracked = true, ignore = '' } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'check-name-'));
  try {
    execFileSync('git', ['init', '-q', dir], { env });
    if (ignore) writeFileSync(join(dir, '.gitignore'), ignore);
    for (const [path, text] of Object.entries(files)) {
      mkdirSync(dirname(join(dir, path)), { recursive: true });
      writeFileSync(join(dir, path), text);
    }
    if (tracked) execFileSync('git', ['add', '-A'], { cwd: dir, env });
    const r = spawnSync(process.execPath, [SCRIPT], { cwd: dir, env, encoding: 'utf8' });
    return { code: r.status, out: r.stdout + r.stderr };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('passes a repository with no former names', () => {
  const r = run({ 'README.md': '# Command Center\n', 'src/a.ts': 'export const a = 1;\n' });
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /no stray references/);
});

test('fails on a former name in an ordinary file and names the line', () => {
  const r = run({ 'src/a.ts': `const ok = 1;\nconst x = '${SECOND}-ui';\n` });
  assert.equal(r.code, 1);
  assert.match(r.out, /src\/a\.ts:2/);
  assert.doesNotMatch(r.out, /src\/a\.ts:1\b/);
});

test('matches either former name in any letter case', () => {
  for (const word of [SECOND.toUpperCase(), 'Program' + 'ish', `x${SECOND}y`]) {
    const r = run({ 'notes.txt': `${word}\n` });
    assert.equal(r.code, 1, `${word} should be flagged`);
  }
});

test('fails on a former name in a file name', () => {
  const r = run({ [`src/${FIRST}Mark.tsx`]: 'export {};\n' });
  assert.equal(r.code, 1);
  assert.match(r.out, /\(file name\)/);
});

test('allows the listed files and the saved prompts', () => {
  const text = `${SECOND} ${FIRST}\n`;
  const r = run({
    'CHANGELOG.md': text,
    'apps/desktop/src/lib/legacy.ts': text,
    'apps/desktop/src-tauri/src/migrate.rs': text,
    'packages/bridge/src/env.ts': text,
    'docs/prompts/2026-01-01-x.md': text,
  });
  assert.equal(r.code, 0, r.out);
});

test('an allowed file name elsewhere in the tree is not allowed', () => {
  const r = run({ 'other/CHANGELOG.md': `${SECOND}\n`, 'docs/prompts-old/x.md': `${SECOND}\n` });
  assert.equal(r.code, 1);
  assert.match(r.out, /other\/CHANGELOG\.md:1/);
  assert.match(r.out, /docs\/prompts-old\/x\.md:1/);
});

test('allows the upstream and status-feed references, but nothing else on the same line', () => {
  const ok = run({
    'README.md': [
      `https://github.com/engineerlish/${SECOND}`,
      `https://raw.githubusercontent.com/engineerlish/${SECOND}-ai-status/main/latest.json`,
      `"${SECOND}_provider": "anthropic"`,
      `https://github.com/engineerlish/${FIRST}`,
    ].join('\n'),
  });
  assert.equal(ok.code, 0, ok.out);

  const bad = run({
    'README.md': `${SECOND} lives at engineerlish/${SECOND}\n"${SECOND}_providers": 1\n`,
  });
  assert.equal(bad.code, 1);
  assert.match(bad.out, /README\.md:1/);
  assert.match(bad.out, /README\.md:2/);
});

test('checks new files before they are staged, but not ignored ones', () => {
  assert.equal(run({ 'new.ts': `${SECOND}\n` }, { tracked: false }).code, 1);
  const ignored = run({ 'out/build.log': `${SECOND}\n` }, { tracked: false, ignore: 'out/\n' });
  assert.equal(ignored.code, 0, ignored.out);
});

test('exempts only dated prompt files in docs/prompts, not its README, and not the lockfile', () => {
  for (const file of ['docs/prompts/README.md', 'pnpm-lock.yaml']) {
    const r = run({ [file]: `${SECOND}\n` });
    assert.notEqual(r.code, 0, file);
  }
  assert.equal(run({ 'docs/prompts/2026-10-17-topic.md': `${SECOND}\n` }).code, 0);
});

test('skips images and fonts', () => {
  const r = run({ [`assets/${SECOND}.png`]: 'x', 'assets/f.woff2': SECOND });
  assert.equal(r.code, 0, r.out);
});

// Only the exact upstream and status-feed repositories are allowed, not look-alikes.
test('flags other engineerlish/<former name>-* references', () => {
  for (const text of [`engineerlish/${SECOND}-desktop`, `engineerlish/${FIRST}2`]) {
    const r = run({ 'README.md': `${text}\n` });
    assert.notEqual(r.code, 0, text);
    assert.match(r.out, /README\.md:1/);
  }
});
