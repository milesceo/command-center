// PreToolUse guard for the project subagents in .claude/agents.
//
// Subagent frontmatter can only allow or deny a whole tool: `Bash(git diff *)` in `tools` does not
// narrow Bash. So the read-only agents keep Bash (they need `git diff`) and this hook enforces the
// rest: it reads the tool call as JSON on stdin and exits 2 (block, reason on stderr) when the call
// is outside the agent's role. Exit 0 allows it. Claude Code treats any other exit code (an
// uncaught exception exits 1) as a non-blocking error and runs the tool, so everything here fails
// closed: an unexpected state is a block.
//
//   node .claude/hooks/agent-guard.mjs <reviewer|ui-polish|tester|regulator>
//
// Profiles:
//   reviewer, ui-polish  Bash is limited to read-only git/gh/inspection commands. No file edits.
//   tester               Bash adds the project's test/check commands. Edit/Write only touch test files.
//   regulator            Bash adds the project's generated-doc checks. Edit/Write only touch the
//                        documentation Markdown files (never .claude/, never generated docs).
//
// This is a guard against a subagent drifting out of role, not a security boundary against a
// hostile one. It is deliberately strict: shell chaining, backgrounding, subshells, redirects,
// substitution, backslash escapes and ANSI-C quoting are all refused outside quotes, and anything
// not on an allowlist is refused. Accepted limit: the tester may write and run test scripts, so a
// determined tester can execute code; the hook catches drift, not malice.
// Tests: scripts/agent-guard.test.mjs.
import { readFileSync } from 'node:fs';
import { isAbsolute, relative, resolve } from 'node:path';

const profile = process.argv[2] ?? '';
const PROFILES = new Set(['reviewer', 'ui-polish', 'tester', 'regulator']);

function block(reason) {
  process.stderr.write(`agent-guard (${profile}): ${reason}\n`);
  process.exit(2);
}

/** Read-only inspection. Every segment of a command must match one of these. */
const READ_ONLY = [
  /^git (diff|log|show|status|blame|ls-files|ls-tree|rev-parse|rev-list|merge-base|shortlog|describe|diff-tree|cat-file|count-objects)( .*)?$/,
  /^git branch( --show-current| -a| -r| -v| -vv| --list( \S+)?)?$/,
  /^git tag$/,
  /^git tag (-l|--list)( \S+)?$/,
  /^git remote( -v)?$/,
  /^git config (--get|--get-all) \S+$/,
  /^git config (--list|-l)$/,
  /^git config (user\.name|user\.email)$/,
  /^gh (pr|issue|run) (view|list|diff|checks|status)( .*)?$/,
  /^gh repo view( .*)?$/,
  /^(ls|pwd|cat|head|tail|wc|grep|findstr|stat|diff)( .*)?$/,
  /^sort( -[nrufd]+)*$/,
  /^uniq( -c)?$/,
  /^cd ("[^"\n]*"|[\w./:@+~-]+)$/,
  // Positional, unquoted paths only: no flags (--fix, --write, -o, -c, -f, --plugin), however spelled.
  /^pnpm exec (prettier --check|eslint)( [^\s|;&<>`$'"-][^\s|;&<>`$'"]*)+$/,
];

/** Extra commands for the tester: run the project's existing test setup, nothing that installs or publishes. */
const TEST_RUNNERS = [
  /^pnpm (--filter \S+ )?(run )?(test|typecheck|format:check|rust:lint|rust:fmt:check|qa:docs:check|design:tokens:check)( .*)?$/,
  /^pnpm (--filter \S+ )?lint$/,
  /^pnpm (--filter \S+ )?(exec )?vitest( .*)?$/,
  /^pnpm (--filter \S+ )?e2e( .*)?$/,
  /^pnpm check$/,
  /^npx vitest( .*)?$/,
  /^cargo (test|clippy|fmt --check|fmt --all -- --check)( .*)?$/,
  /^node --test( [\w./-]+)+$/,
  /^node --experimental-strip-types --no-warnings scripts\/(qa-docs|export-tokens)\.mjs --check$/,
  /^node scripts\/(check-name|release-tools)\.mjs( [\w./=:-]+)*$/,
  /^(E2E_[A-Z_]+=("[^"]*"|\S+) )*node apps\/desktop\/e2e\/[\w.-]+\.mjs( [\w./=:-]+)*$/,
];

/** Extra commands for the regulator: re-run the generated-doc and name guards. */
const REGULATOR_CHECKS = [
  /^pnpm (qa:docs:check|design:tokens:check|format:check)$/,
  /^node scripts\/check-name\.mjs$/,
  /^node --experimental-strip-types --no-warnings scripts\/(qa-docs|export-tokens)\.mjs --check$/,
];

function allowedBash() {
  const list = [...READ_ONLY];
  if (profile === 'tester') list.push(...TEST_RUNNERS);
  if (profile === 'regulator') list.push(...REGULATOR_CHECKS);
  return list;
}

/**
 * Replace the inside of quoted strings with spaces so operators inside them are not mistaken for
 * shell syntax. Both quote kinds are always tracked (a ' inside "..." is a plain character); only
 * the kinds listed in `blank` have their contents hidden.
 */
function maskQuotes(text, blank) {
  let out = '';
  let open = '';
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (open) {
      if (ch === '\\' && open === '"') {
        out += '  ';
        i++;
      } else if (ch === open) {
        open = '';
        out += ch;
      } else {
        out += blank.includes(open) ? ' ' : ch;
      }
    } else if (ch === "'" || ch === '"') {
      open = ch;
      out += ch;
    } else {
      out += ch;
    }
  }
  return out;
}

function checkBash(command) {
  if (typeof command !== 'string' || command.trim() === '') block('empty command');
  // Harmless stderr redirects are fine; every other redirect, substitution or backtick is not.
  const cleaned = command.replace(/\s2>&1(?=\s|$)/g, '').replace(/\s2>\/dev\/null(?=\s|$)/g, '');
  // Command substitution still runs inside double quotes, so only single-quoted text is masked here.
  const noSingle = maskQuotes(cleaned, ["'"]);
  if (/`|\$\(|\$\{/.test(noSingle)) block(`substitutions are not allowed: ${command}`);
  // Everything quoted is data: mask both kinds to find the real operators and segment boundaries.
  const masked = maskQuotes(cleaned, ["'", '"']);
  if (/[<>]/.test(masked)) block(`redirects are not allowed: ${command}`);
  // `HEAD@{1}` style refs are plain words in bash (no brace expansion), so they are not groups.
  if (/[(){}]/.test(masked.replace(/@\{[\w.-]*\}/g, ''))) {
    block(`subshells and command groups are not allowed: ${command}`);
  }
  if (/(^|\s)#/.test(masked)) block(`comments are not allowed: ${command}`);
  if (/\r/.test(cleaned)) block(`carriage returns are not allowed: ${command}`);
  if (/\\/.test(masked)) block(`backslash escapes outside quotes are not allowed: ${command}`);
  if (/\$['"]/.test(masked)) block(`ANSI-C and locale quoting are not allowed: ${command}`);
  // Options that write or run programs, checked on the text with quotes removed (the shell removes
  // them too, so "--output=x" is the same option).
  const unquoted = cleaned.replace(/['"]/g, '');
  if (/(^|\s)--o(u(t(p(u(t)?)?)?)?)?(=|\s|$)/i.test(unquoted)) {
    block(`--output writes a file: ${command}`);
  }
  if (
    /(^|\s)--(ext-diff|textconv|open-files-in-pager|fix|fix-dry-run|write|allow-dirty|allow-staged|outputFile|output-file|eval|print|require|import|loader|config)(=|\s|$)/.test(
      unquoted,
    )
  ) {
    block(`option not allowed for this agent: ${command}`);
  }
  const list = allowedBash();
  // Split on pipes, &, &&, ||, ; and newlines (outside quotes); every segment must be on the allowlist.
  const segments = [];
  let start = 0;
  for (const match of masked.matchAll(/\|\||&&|[|;&\n]/g)) {
    segments.push(cleaned.slice(start, match.index));
    start = match.index + match[0].length;
  }
  segments.push(cleaned.slice(start));
  for (const raw of segments) {
    const segment = raw.trim();
    if (segment === '') continue;
    if (!list.some((pattern) => pattern.test(segment))) {
      block(`command not allowed for this agent: "${segment}"`);
    }
  }
}

/** The path relative to the project, with forward slashes; null when it escapes the project. */
function projectRelative(file) {
  if (typeof file !== 'string' || file === '') return null;
  const root = resolve(process.env.CLAUDE_PROJECT_DIR || process.cwd());
  const rel = relative(root, resolve(root, file)).replace(/\\/g, '/');
  if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return null;
  // Windows 8.3 short names (DOCS~1) would sidestep the name rules below.
  if (/~\d/.test(rel)) return null;
  return rel;
}

/** Never writable by a subagent, whatever the role: its own definitions, git internals, dependencies. */
const PROTECTED = /^(\.claude|\.git|node_modules)(\/|$)/i;

/** Test files: Vitest/node:test specs, the e2e harness, fixtures and Rust integration tests. */
function isTestFile(rel) {
  if (PROTECTED.test(rel)) return false;
  if (/\.(test|spec)\.(ts|tsx|mjs|js)$/.test(rel)) return true;
  if (/^apps\/desktop\/e2e\//.test(rel)) return true;
  if (/^packages\/bridge\/test\//.test(rel)) return true;
  if (/^apps\/desktop\/src-tauri\/tests\//.test(rel)) return true;
  return /(^|\/)(__tests__|__fixtures__)\//.test(rel);
}

/** Documentation: the named top-level Markdown files, docs/ and .github/ Markdown. Generated docs are produced by pnpm scripts instead. */
function isDocFile(rel) {
  if (PROTECTED.test(rel)) return false;
  if (rel.toLowerCase() === 'docs/testing.md') return false;
  if (/^(README|CHANGELOG|CLAUDE)\.md$/.test(rel)) return true;
  return /^(docs|\.github)\/.+\.md$/i.test(rel);
}

function main() {
  if (!PROFILES.has(profile)) block(`unknown profile "${profile}"`);

  let call;
  try {
    call = JSON.parse(readFileSync(0, 'utf8'));
  } catch {
    block('could not read the tool call');
  }
  if (!call || typeof call !== 'object') block('the tool call is not an object');

  const tool = call.tool_name;
  const input = call.tool_input && typeof call.tool_input === 'object' ? call.tool_input : {};

  if (tool === 'Bash') {
    checkBash(input.command);
  } else if (
    tool === 'Edit' ||
    tool === 'Write' ||
    tool === 'NotebookEdit' ||
    tool === 'MultiEdit'
  ) {
    const raw = input.file_path ?? input.notebook_path;
    const rel = projectRelative(raw);
    if (profile === 'tester') {
      if (rel !== null && isTestFile(rel)) process.exit(0);
      block(
        `only test files may be edited (*.test.*, apps/desktop/e2e/, packages/bridge/test/, apps/desktop/src-tauri/tests/): ${raw}`,
      );
    }
    if (profile === 'regulator') {
      if (rel !== null && isDocFile(rel)) process.exit(0);
      block(
        `only documentation Markdown may be edited (README, CHANGELOG, CLAUDE.md, docs/, .github/; not .claude/ or generated docs/TESTING.md): ${raw}`,
      );
    }
    block('this agent is read-only');
  } else if (typeof tool !== 'string') {
    block('the tool call has no tool name');
  }
  process.exit(0);
}

try {
  main();
} catch (error) {
  block(`unexpected error, refusing: ${error instanceof Error ? error.message : String(error)}`);
}
