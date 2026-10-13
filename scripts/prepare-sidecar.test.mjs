import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runtimePackage } from './prepare-sidecar.mjs';

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
