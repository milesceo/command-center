import assert from 'node:assert/strict';
import { test } from 'node:test';
import { manifestVersions, mismatches, notesFor, versionFromTag } from './release-tools.mjs';

const changelog = `# Changelog

## [Unreleased]

## [1.1.0] - 2026-12-01

### Added

- Later thing

## [1.0.0] - 2026-10-14

### Added

- First thing
- Second thing

### Fixed

- A fix

[Unreleased]: https://example.com/compare/v1.0.0...HEAD
[1.0.0]: https://example.com/releases/tag/v1.0.0
`;

test('versionFromTag accepts release tags only', () => {
  assert.equal(versionFromTag('v1.2.3'), '1.2.3');
  assert.equal(versionFromTag('1.2.3'), '1.2.3');
  assert.throws(() => versionFromTag('v1.2'), /not a release tag/);
  assert.throws(() => versionFromTag('v1.2.3-rc1'), /not a release tag/);
});

test('notesFor returns just the requested section, without link references', () => {
  const notes = notesFor(changelog, '1.0.0');
  assert.match(notes, /^### Added/);
  assert.match(notes, /First thing/);
  assert.match(notes, /A fix/);
  assert.doesNotMatch(notes, /Later thing/);
  assert.doesNotMatch(notes, /example\.com/);
  assert.ok(notes.endsWith('\n'));
});

test('notesFor does not confuse 1.0.0 with 11.0.0, and fails loudly when missing or empty', () => {
  assert.throws(() => notesFor(changelog, '2.0.0'), /no section for 2\.0\.0/);
  assert.throws(() => notesFor('## [1.0.0] - x\n\n## [0.9.0]\n- a\n', '1.0.0'), /empty/);
  assert.match(notesFor('## [11.0.0]\n- big\n## [1.0.0]\n- small\n', '1.0.0'), /small/);
});

test('mismatches names every manifest that disagrees with the tag', () => {
  const versions = { a: '1.0.0', b: '0.9.0', c: undefined };
  assert.deepEqual(mismatches(versions, '1.0.0'), [
    ['b', '0.9.0'],
    ['c', undefined],
  ]);
});

test('the real manifests can all be read', () => {
  const versions = manifestVersions();
  assert.equal(Object.keys(versions).length, 4);
  for (const v of Object.values(versions)) assert.match(v, /^\d+\.\d+\.\d+$/);
});
