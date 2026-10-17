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
// On macOS the two native binaries are made executable, ad-hoc signed (`codesign --force --sign
// -`, so Gatekeeper and Apple Silicon's signature check accept them inside an unsigned app) and
// stripped of the quarantine flag. The runtime is picked for the *target* architecture, so an
// Intel build on an Apple Silicon Mac uses the x64 runtime (when pnpm installed it).
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

/** Node's name for the CPU a Rust target triple builds for (`aarch64-apple-darwin` -> `arm64`). */
export function archFromTriple(triple) {
  if (triple.startsWith('aarch64-')) return 'arm64';
  if (triple.startsWith('x86_64-')) return 'x64';
  throw new Error(`Unsupported target ${triple}`);
}

/**
 * Prepares a copied native binary for macOS: executable bits, an ad-hoc signature (copying keeps
 * the bytes, but re-signing ad hoc also drops a hardened-runtime flag the bundled Node would need
 * entitlements for) and no quarantine flag. `run` is injectable for tests.
 */
export function prepareMacBinary(
  file,
  run = (cmd, args) => execFileSync(cmd, args, { stdio: 'pipe' }),
) {
  chmodSync(file, 0o755);
  run('codesign', ['--force', '--sign', '-', file]);
  try {
    run('xattr', ['-d', 'com.apple.quarantine', file]);
  } catch {
    // Not quarantined: nothing to remove.
  }
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
  const platform = triple.includes('apple-darwin') ? 'darwin' : process.platform;
  const { pkg, file } = runtimePackage(platform, archFromTriple(triple));
  const require = createRequire(join(bridgeDir, 'package.json'));
  const sdkRequire = createRequire(require.resolve('@anthropic-ai/claude-agent-sdk'));
  let runtime;
  try {
    runtime = join(dirname(sdkRequire.resolve(`${pkg}/package.json`)), file);
  } catch {
    throw new Error(
      `${pkg} is not installed, so there is no Claude runtime for ${triple}. ` +
        "pnpm installs only the host platform's runtime; build on a matching machine.",
    );
  }
  if (!existsSync(runtime)) throw new Error(`Claude runtime not found at ${runtime}.`);
  const claudeOut = join(resources, `claude${exe}`);
  copyFileSync(runtime, claudeOut);
  if (platform === 'darwin') prepareMacBinary(claudeOut);
  else if (!exe) chmodSync(claudeOut, 0o755);

  // 3. Node itself, named the way Tauri expects an external binary.
  const binaries = join(tauriDir, 'binaries');
  mkdirSync(binaries, { recursive: true });
  const nodeOut = join(binaries, `node-${triple}${exe}`);
  if (archFromTriple(triple) !== process.arch && platform === process.platform) {
    throw new Error(
      `This Node is ${process.arch}, but the target is ${triple}. Run the build with a Node for that CPU.`,
    );
  }
  copyFileSync(process.execPath, nodeOut);
  if (platform === 'darwin') prepareMacBinary(nodeOut);
  else if (!exe) chmodSync(nodeOut, 0o755);

  console.log(`bridge   ${mb(join(resources, 'main.mjs'))}  ${join(resources, 'main.mjs')}`);
  console.log(`runtime  ${mb(claudeOut)}  ${claudeOut}`);
  console.log(`node     ${mb(nodeOut)}  ${nodeOut}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) main();
