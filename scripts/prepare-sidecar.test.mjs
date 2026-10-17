import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtempSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { archFromTriple, prepareMacBinary, runtimePackage } from './prepare-sidecar.mjs';

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
  assert.equal(statSync(file).mode & 0o777, 0o755);
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
