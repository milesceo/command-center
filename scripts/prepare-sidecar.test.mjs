import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  archFromTriple,
  assertLiteSupported,
  isLite,
  prepareMacBinary,
  runtimePackage,
  writeLite,
} from './prepare-sidecar.mjs';

test('maps platforms to the SDK runtime package and file', () => {
  assert.deepEqual(runtimePackage('win32', 'x64'), {
    pkg: '@anthropic-ai/claude-agent-sdk-win32-x64',
    file: 'claude.exe',
  });
  assert.deepEqual(runtimePackage('linux', 'arm64'), {
    pkg: '@anthropic-ai/claude-agent-sdk-linux-arm64',
    file: 'claude',
  });
  assert.deepEqual(runtimePackage('darwin', 'arm64'), {
    pkg: '@anthropic-ai/claude-agent-sdk-darwin-arm64',
    file: 'claude',
  });
});

test('rejects platforms the SDK does not ship a runtime for', () => {
  assert.throws(() => runtimePackage('freebsd', 'x64'), /Unsupported platform/);
  assert.throws(() => runtimePackage('win32', 'ia32'), /Unsupported platform/);
});

test('reads the CPU from a Rust target triple', () => {
  assert.equal(archFromTriple('aarch64-apple-darwin'), 'arm64');
  assert.equal(archFromTriple('x86_64-apple-darwin'), 'x64');
  assert.equal(archFromTriple('x86_64-pc-windows-msvc'), 'x64');
  assert.throws(() => archFromTriple('i686-pc-windows-msvc'), /Unsupported target/);
});

test('prepares a macOS binary: executable, ad-hoc signed, quarantine removed', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cc-sidecar-')), 'claude');
  writeFileSync(file, '');
  const calls = [];
  prepareMacBinary(file, (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'xattr') throw new Error('No such xattr'); // not quarantined is fine
  });
  // Windows has no Unix permission bits; the helper only ever runs for macOS builds.
  if (process.platform !== 'win32') assert.equal(statSync(file).mode & 0o777, 0o755);
  assert.deepEqual(calls, [
    ['codesign', '--force', '--sign', '-', file],
    ['xattr', '-d', 'com.apple.quarantine', file],
  ]);
});

test('a failed signature stops the build', () => {
  const file = join(mkdtempSync(join(tmpdir(), 'cc-sidecar-')), 'node');
  writeFileSync(file, '');
  assert.throws(
    () =>
      prepareMacBinary(file, (cmd) => {
        if (cmd === 'codesign') throw new Error('codesign failed');
      }),
    /codesign failed/,
  );
});

test('the lite flavour is chosen by --lite or COMMAND_CENTER_LITE', () => {
  assert.equal(isLite(['node', 'x', '--lite'], {}), true);
  assert.equal(isLite([], { COMMAND_CENTER_LITE: '1' }), true);
  assert.equal(isLite([], { COMMAND_CENTER_LITE: 'yes' }), true);
  for (const off of [undefined, '', '0', 'false', 'FALSE', ' ']) {
    assert.equal(isLite([], { COMMAND_CENTER_LITE: off }), false, String(off));
  }
});

test('the lite layout has the marker and empty node and claude stand-ins', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-lite-'));
  const resources = join(root, 'resources');
  const binaries = join(root, 'binaries');
  mkdirSync(resources); // main() creates it before copying the bridge
  writeLite(resources, binaries, 'aarch64-apple-darwin', '');
  assert.match(readFileSync(join(resources, 'lite'), 'utf8'), /installed Node/);
  assert.equal(statSync(join(resources, 'claude')).size, 0);
  assert.equal(statSync(join(binaries, 'node-aarch64-apple-darwin')).size, 0);
  assert.equal(existsSync(join(resources, 'main.mjs')), false);
});

// The release smoke test must refuse a lite or placeholder layout. It exits at the first empty
// stand-in, before it would run anything from the layout.
const smoke = join(dirname(fileURLToPath(import.meta.url)), 'smoke-installed.mjs');
const exe = process.platform === 'win32' ? '.exe' : '';

test('the installed-app smoke test fails on an empty node stand-in', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-smoke-'));
  mkdirSync(join(root, 'resources', 'bridge'), { recursive: true });
  writeFileSync(join(root, `node${exe}`), '');
  writeFileSync(join(root, 'resources', 'bridge', 'main.mjs'), '// bridge\n');
  writeFileSync(join(root, 'resources', 'bridge', `claude${exe}`), 'not empty');
  const run = spawnSync(process.execPath, [smoke, root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, new RegExp(`FAIL node${exe} at .* is an empty stand-in`));
  assert.doesNotMatch(run.stdout, /found .*node/);
});

test('the installed-app smoke test fails on the lite layout prepare-sidecar writes', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-smoke-lite-'));
  const resources = join(root, 'resources', 'bridge');
  mkdirSync(resources, { recursive: true });
  writeFileSync(join(resources, 'main.mjs'), '// bridge\n');
  // Tauri installs the external binary beside the app as plain `node`.
  writeLite(resources, join(root, 'binaries'), 'aarch64-apple-darwin', exe);
  writeFileSync(join(root, `node${exe}`), '');
  const run = spawnSync(process.execPath, [smoke, root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /is an empty stand-in \(lite or placeholder build\)/);
});

test('the installed-app smoke test fails on an empty claude stand-in after finding node', () => {
  const root = mkdtempSync(join(tmpdir(), 'cc-smoke-claude-'));
  mkdirSync(join(root, 'resources', 'bridge'), { recursive: true });
  writeFileSync(join(root, `node${exe}`), 'not empty');
  writeFileSync(join(root, 'resources', 'bridge', 'main.mjs'), '// bridge\n');
  writeFileSync(join(root, 'resources', 'bridge', `claude${exe}`), '');
  const run = spawnSync(process.execPath, [smoke, root], { encoding: 'utf8', timeout: 30_000 });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, new RegExp(`FAIL claude${exe} at .* is an empty stand-in`));
});

test('the lite build is refused for Windows targets before anything is built', () => {
  assert.throws(() => assertLiteSupported(true, '.exe'), /not supported on Windows/);
  assert.doesNotThrow(() => assertLiteSupported(true, ''));
  assert.doesNotThrow(() => assertLiteSupported(false, '.exe'));
});
