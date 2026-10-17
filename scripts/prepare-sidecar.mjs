#!/usr/bin/env node
// Assembles what the installed app needs next to itself, so it runs without a dev setup:
//
//   src-tauri/binaries/node-<target-triple>[.exe]   the Node runtime, a Tauri "external binary"
//   src-tauri/resources/bridge/main.mjs             the bridge with the Agent SDK bundled in
//   src-tauri/resources/bridge/claude[.exe]         the SDK's native Claude runtime (same version)
//
// `--placeholder` only creates empty stand-ins so `cargo check`, clippy and `tauri dev` (which use the
// system Node and the workspace bridge) can compile: tauri-build requires these files to exist.
//
// Run before `tauri build` (tauri.conf.json's beforeBuildCommand does). Everything it writes is
// git-ignored. The user still needs to be logged in to Claude Code; the login is read from their
// own profile, never bundled.
import { execFileSync } from 'node:child_process';
import {
  chmodSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tauriDir = join(root, 'apps/desktop/src-tauri');
const bridgeDir = join(root, 'packages/bridge');

/** The platform package the SDK ships its native runtime in, and the file inside it. */
export function runtimePackage(platform = process.platform, arch = process.arch) {
  const names = { win32: 'win32', darwin: 'darwin', linux: 'linux' };
  const cpu = { x64: 'x64', arm64: 'arm64' };
  if (!names[platform] || !cpu[arch]) throw new Error(`Unsupported platform ${platform}-${arch}`);
  return {
    pkg: `@anthropic-ai/claude-agent-sdk-${names[platform]}-${cpu[arch]}`,
    file: platform === 'win32' ? 'claude.exe' : 'claude',
  };
}

/** `x86_64-pc-windows-msvc` and friends: Tauri names external binaries by Rust target triple. */
export function hostTriple() {
  const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
  const host = /^host: (.+)$/m.exec(out)?.[1];
  if (!host) throw new Error('Could not read the host target triple from `rustc -vV`.');
  return host;
}

const mb = (path) => `${(statSync(path).size / 1048576).toFixed(1)} MB`;

function placeholders(triple, exe) {
  const files = [
    join(tauriDir, 'binaries', `node-${triple}${exe}`),
    join(tauriDir, 'resources', 'bridge', 'main.mjs'),
    join(tauriDir, 'resources', 'bridge', `claude${exe}`),
  ];
  for (const file of files) {
    if (existsSync(file)) continue;
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, '');
  }
  console.log('placeholder sidecar files in place (not for release builds)');
}

function main() {
  const triple = process.env.TAURI_ENV_TARGET_TRIPLE ?? hostTriple();
  const exe = triple.includes('windows') ? '.exe' : '';
  if (process.argv.includes('--placeholder')) return placeholders(triple, exe);

  // 1. The bridge, self-contained.
  execFileSync('pnpm', ['--filter', '@command-center/bridge', 'build:release'], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });
  const resources = join(tauriDir, 'resources', 'bridge');
  rmSync(resources, { recursive: true, force: true });
  mkdirSync(resources, { recursive: true });
  copyFileSync(join(bridgeDir, 'dist/release/main.mjs'), join(resources, 'main.mjs'));

  // 2. The Claude runtime the SDK would otherwise look for in node_modules.
  const { pkg, file } = runtimePackage();
  const require = createRequire(join(bridgeDir, 'package.json'));
  const sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'));
  const runtime = join(dirname(sdkRequire.resolve(`${pkg}/package.json`)), file);
  if (!existsSync(runtime)) throw new Error(`Claude runtime not found at ${runtime}.`);
  const claudeOut = join(resources, `claude${exe}`);
  copyFileSync(runtime, claudeOut);
  if (!exe) chmodSync(claudeOut, 0o755);

  // 3. Node itself, named the way Tauri expects an external binary.
  const binaries = join(tauriDir, 'binaries');
  mkdirSync(binaries, { recursive: true });
  const nodeOut = join(binaries, `node-${triple}${exe}`);
  copyFileSync(process.execPath, nodeOut);
  if (!exe) chmodSync(nodeOut, 0o755);

  console.log(`bridge   ${mb(join(resources, 'main.mjs'))}  ${join(resources, 'main.mjs')}`);
  console.log(`runtime  ${mb(claudeOut)}  ${claudeOut}`);
  console.log(`node     ${mb(nodeOut)}  ${nodeOut}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
