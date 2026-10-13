#!/usr/bin/env node
// Helpers for the release workflow.
//   node scripts/release-tools.mjs check-version v1.0.0     fail unless every manifest says 1.0.0
//   node scripts/release-tools.mjs notes v1.0.0 > notes.md   the CHANGELOG section for that version
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** `v1.2.3` or `1.2.3` to `1.2.3`; throws on anything that is not a plain release version. */
export function versionFromTag(tag) {
  const m = /^v?(\d+\.\d+\.\d+)$/.exec(tag.trim());
  if (!m) throw new Error(`"${tag}" is not a release tag like v1.2.3.`);
  return m[1];
}

/** The body of the `## [version]` section of a Keep a Changelog file, without its heading. */
export function notesFor(changelog, version) {
  const lines = changelog.split(/\r?\n/);
  const start = lines.findIndex((l) =>
    new RegExp(`^##\\s+\\[${version.replaceAll('.', '\\.')}\\]`).test(l),
  );
  if (start < 0) throw new Error(`CHANGELOG.md has no section for ${version}.`);
  let end = lines.findIndex((l, i) => i > start && /^##\s+\[/.test(l));
  if (end < 0) end = lines.length;
  // Trailing link references (`[1.0.0]: https://...`) belong to the file, not the section.
  const body = lines
    .slice(start + 1, end)
    .filter((l) => !/^\[[^\]]+\]:\s+\S+/.test(l))
    .join('\n')
    .trim();
  if (!body) throw new Error(`The CHANGELOG.md section for ${version} is empty.`);
  return `${body}\n`;
}

/** Version strings found in each manifest the release depends on. */
export function manifestVersions(read = (p) => readFileSync(join(root, p), 'utf8')) {
  const json = (p) => JSON.parse(read(p)).version;
  const cargo = /^version\s*=\s*"([^"]+)"/m.exec(read('apps/desktop/src-tauri/Cargo.toml'))?.[1];
  return {
    'package.json': json('package.json'),
    'apps/desktop/package.json': json('apps/desktop/package.json'),
    'apps/desktop/src-tauri/tauri.conf.json': json('apps/desktop/src-tauri/tauri.conf.json'),
    'apps/desktop/src-tauri/Cargo.toml': cargo,
  };
}

export function mismatches(versions, expected) {
  return Object.entries(versions).filter(([, v]) => v !== expected);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [command, tag] = process.argv.slice(2);
  try {
    const version = versionFromTag(tag ?? '');
    if (command === 'check-version') {
      const bad = mismatches(manifestVersions(), version);
      if (bad.length) {
        for (const [file, v] of bad) console.error(`${file} says ${v}, the tag says ${version}`);
        process.exit(1);
      }
      console.log(`all manifests are at ${version}`);
    } else if (command === 'notes') {
      process.stdout.write(notesFor(readFileSync(join(root, 'CHANGELOG.md'), 'utf8'), version));
    } else {
      throw new Error('usage: release-tools.mjs <check-version|notes> <tag>');
    }
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}
