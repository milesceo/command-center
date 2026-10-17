// Tests for .claude/hooks/agent-guard.mjs, the permission guard behind the project subagents.
// Each case spawns the hook with a tool call on stdin and checks the exit code: 0 allows, 2 blocks.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const hook = join(root, '.claude', 'hooks', 'agent-guard.mjs');

function run(profile, input) {
  const raw = typeof input === 'string' ? input : JSON.stringify(input);
  const result = spawnSync(process.execPath, [hook, profile], {
    input: raw,
    encoding: 'utf8',
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  return result.status;
}

const bash = (command) => ({ tool_name: 'Bash', tool_input: { command } });
const edit = (file_path, tool_name = 'Edit') => ({ tool_name, tool_input: { file_path } });
const at = (...parts) => join(root, ...parts);

const ALL = ['reviewer', 'ui-polish', 'tester', 'regulator'];

test('read-only commands are allowed for every profile', () => {
  const commands = [
    'git status',
    'git diff main...HEAD',
    'git diff --staged | head -50',
    'git show 48425a9 --stat 2>&1',
    "git log -1 --format='%an <%ae>%n%B'",
    'git log --format="%h | %s" main..HEAD',
    'git show 48425a9:apps/desktop/src/App.tsx | grep -n "settings-\\|id="',
    "git log --grep='a;b' | head -3",
    'git config user.name',
    'git config --get user.email',
    'git branch --show-current',
    'git tag --list v1*',
    'gh pr view 12 --json title,body',
    'gh pr diff 12',
    'ls apps/desktop/src',
    'cat CLAUDE.md | wc -l',
    'grep -rn "TODO" docs | sort | uniq -c',
    'pnpm exec prettier --check docs/prompts/README.md',
    'cd apps/desktop',
    'cd "apps/desktop" && git status',
    'git show HEAD@{1}',
    'git diff stash@{0}',
  ];
  for (const profile of ALL) {
    for (const command of commands) {
      assert.equal(run(profile, bash(command)), 0, `${profile}: ${command}`);
    }
  }
});

test('writes, chaining and escapes are blocked for every profile', () => {
  const commands = [
    'git commit -m x',
    'git push',
    'git status > probe.txt',
    'git status >> probe.txt',
    'git diff && rm -rf x',
    'git diff; rm x',
    'git status & touch x',
    'git status || touch x',
    'git diff\ntouch x',
    'git log "$(touch x)"',
    'git log `touch x`',
    'git log ${HOME}',
    "ls \\' ; touch x ; \\'",
    "ls $'a' ; touch x",
    '(git status; touch x)',
    '{ touch x; }',
    // A quote of one kind inside the other must not hide a substitution or a newline.
    'git log "\'"`touch x`"\'"',
    'git log "\'"$(touch x)"\'"',
    "cd x #'\ntouch y\n#'",
    'cd x # touch y',
    'cd "x"\ntouch y',
    // Quoted short options must not slip past the "positional paths only" rule.
    "pnpm exec prettier --check ''-w docs",
    'pnpm exec eslint "-o" out.txt src',
    'pnpm exec eslint "-f" x.mjs src',
    'node scripts/smoke-installed.mjs x',
    'git diff --outputFile=x',
    'git diff --output=x',
    'git diff "--output=x"',
    "git diff --output''=x",
    'git diff --outp=x',
    'git diff --ext-diff',
    'git show --textconv HEAD:a',
    'git tag v9.9.9',
    'git tag -d v1.0.0',
    'git config user.name someone',
    'git config --global user.email a@b.c',
    'git branch -D main',
    'git grep -Osh x',
    'sort -o out in',
    'uniq in out',
    'rg --pre sh x',
    'sed -n -i s/a/b/ f',
    'sed -n 1p f',
    'tree -o f',
    'pnpm exec eslint --fix .',
    'pnpm exec eslint -o out.txt src',
    'pnpm exec prettier --check --write src',
    'pnpm install',
    'node --version',
    'rm -rf x',
  ];
  for (const profile of ALL) {
    for (const command of commands) {
      assert.equal(run(profile, bash(command)), 2, `${profile}: ${command}`);
    }
  }
});

test('the tester may run the project test commands, and only those', () => {
  const allowed = [
    'pnpm test',
    'pnpm check',
    'pnpm lint',
    'pnpm typecheck',
    'pnpm format:check',
    'pnpm --filter @command-center/desktop exec vitest run src/qa/qa.test.tsx',
    'pnpm --filter @command-center/bridge test',
    'cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml',
    'pnpm rust:lint',
    'node --test scripts/agent-guard.test.mjs',
    'node --experimental-strip-types --no-warnings scripts/qa-docs.mjs --check',
    'node scripts/check-name.mjs',
    'E2E_CHROMIUM="C:/Program Files/Google/Chrome/Application/chrome.exe" node apps/desktop/e2e/onboarding.mjs',
    'node apps/desktop/e2e/a11y.mjs',
  ];
  for (const command of allowed) {
    assert.equal(run('tester', bash(command)), 0, command);
  }
  const blocked = [
    'pnpm lint --fix',
    'pnpm --filter @command-center/desktop lint --fix',
    'cargo clippy --fix --allow-dirty',
    'node -e "process.exit(0)"',
    'node --test --eval "x"',
    'node --experimental-strip-types --no-warnings scripts/qa-docs.mjs',
    'node scripts/prepare-sidecar.mjs',
    'pnpm sidecar',
    'pnpm dev',
    'pnpm format',
  ];
  for (const command of blocked) {
    assert.equal(run('tester', bash(command)), 2, command);
  }
  // Reviewer, UI Polish and Regulator do not get the test commands.
  for (const profile of ['reviewer', 'ui-polish', 'regulator']) {
    assert.equal(run(profile, bash('pnpm test')), 2, `${profile}: pnpm test`);
  }
});

test('the regulator may re-run the doc guards, and only those', () => {
  for (const command of [
    'pnpm qa:docs:check',
    'pnpm design:tokens:check',
    'pnpm format:check',
    'node scripts/check-name.mjs',
  ]) {
    assert.equal(run('regulator', bash(command)), 0, command);
  }
  for (const command of ['pnpm qa:docs', 'pnpm design:tokens', 'pnpm lint', 'pnpm check']) {
    assert.equal(run('regulator', bash(command)), 2, command);
  }
});

test('read-only profiles cannot edit or write anything', () => {
  for (const profile of ['reviewer', 'ui-polish']) {
    for (const tool of ['Edit', 'Write', 'NotebookEdit', 'MultiEdit']) {
      assert.equal(run(profile, edit(at('CLAUDE.md'), tool)), 2, `${profile}: ${tool}`);
      assert.equal(run(profile, edit(at('apps', 'desktop', 'src', 'a.test.ts'), tool)), 2);
    }
  }
});

test('the tester edits test files only', () => {
  const allowed = [
    at('apps', 'desktop', 'src', 'lib', 'x.test.ts'),
    at('apps', 'desktop', 'src', 'components', 'y.test.tsx'),
    at('scripts', 'agent-guard.test.mjs'),
    at('apps', 'desktop', 'e2e', 'new-flow.mjs'),
    at('packages', 'bridge', 'test', 'fixtures', 'a.json'),
    at('apps', 'desktop', 'src-tauri', 'tests', 'lock.rs'),
    'apps/desktop/src/lib/x.test.ts',
    'apps\\desktop\\src\\lib\\x.test.ts',
  ];
  for (const file of allowed) assert.equal(run('tester', edit(file)), 0, file);
  const blocked = [
    at('apps', 'desktop', 'src', 'lib', 'x.ts'),
    at('apps', 'desktop', 'src', 'components', 'y.tsx'),
    at('apps', 'desktop', 'src-tauri', 'src', 'lock.rs'),
    at('package.json'),
    at('CLAUDE.md'),
    at('.claude', 'agents', 'tester.md'),
    at('.claude', 'hooks', 'agent-guard.test.mjs'),
    at('node_modules', 'pkg', 'index.test.js'),
    // A parent-directory segment must not smuggle a source file into the e2e rule.
    join(root, 'apps', 'desktop', 'e2e', '..', 'src', 'lib', 'repo.ts'),
    'apps/desktop/e2e/../src/lib/repo.ts',
    // Outside the project entirely.
    join(root, '..', 'elsewhere', 'e2e', 'a.mjs'),
    'src/lib/x.ts',
    '',
  ];
  for (const file of blocked) assert.equal(run('tester', edit(file)), 2, file);
});

test('the regulator edits documentation Markdown only', () => {
  const allowed = [
    at('README.md'),
    at('CHANGELOG.md'),
    at('CLAUDE.md'),
    at('docs', 'providers.md'),
    at('docs', 'prompts', '2026-10-17-subagents.md'),
    at('.github', 'pull_request_template.md'),
    'docs/HANDOFF.md',
    'docs\\design-tools.md',
  ];
  for (const file of allowed) assert.equal(run('regulator', edit(file, 'Write')), 0, file);
  const blocked = [
    at('docs', 'TESTING.md'),
    at('docs', 'testing.md'),
    at('docs', '.', 'TESTING.md'),
    join(root, 'docs', 'x', '..', 'TESTING.md'),
    'docs/TESTING.md',
    at('docs', 'design', 'tokens.json'),
    at('apps', 'desktop', 'src', 'lib', 'x.ts'),
    at('package.json'),
    at('.claude', 'agents', 'regulator.md'),
    at('.claude', 'agents', 'nested', 'x.md'),
    at('.claude', 'hooks', 'agent-guard.mjs'),
    at('node_modules', 'pkg', 'README.md'),
    join(root, '..', 'outside.md'),
    'notes.md',
    '',
  ];
  for (const file of blocked) assert.equal(run('regulator', edit(file, 'Write')), 2, file);
});

test('the guard fails closed on bad input', () => {
  for (const profile of ALL) {
    assert.equal(run(profile, ''), 2, 'empty input');
    assert.equal(run(profile, 'not json'), 2, 'not json');
    assert.equal(run(profile, '{"tool_name":'), 2, 'truncated json');
    assert.equal(run(profile, 'null'), 2, 'null');
    assert.equal(run(profile, '42'), 2, 'number');
    assert.equal(run(profile, { tool_input: {} }), 2, 'no tool name');
    assert.equal(run(profile, bash('')), 2, 'empty command');
    assert.equal(run(profile, { tool_name: 'Bash', tool_input: { command: 42 } }), 2, 'non-string');
    assert.equal(run(profile, { tool_name: 'Bash' }), 2, 'no input');
  }
  assert.equal(run('nobody', bash('git status')), 2, 'unknown profile');
  assert.equal(run('Reviewer', bash('git status')), 2, 'profile names are case-sensitive');
  assert.equal(run('', bash('git status')), 2, 'missing profile');
});

test('tools the guard does not police pass through', () => {
  for (const profile of ALL) {
    assert.equal(
      run(profile, { tool_name: 'Read', tool_input: { file_path: at('CLAUDE.md') } }),
      0,
    );
  }
});
