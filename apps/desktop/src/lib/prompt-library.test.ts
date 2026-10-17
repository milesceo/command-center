import { describe, expect, it } from 'vitest';
import {
  LibraryFileError,
  buildLibraryFile,
  normalizeTags,
  parseLibraryFile,
  parseTagInput,
} from './prompt-library';
import type { Prompt } from './types';

const prompt = (over: Partial<Prompt> = {}): Prompt => ({
  id: 'p1',
  kind: 'prompt',
  title: 'Review',
  body: 'Review {{language}}',
  tags: ['code'],
  createdAt: 1,
  updatedAt: 2,
  ...over,
});

describe('library file', () => {
  it('round-trips through JSON', () => {
    const file = buildLibraryFile(
      [prompt(), prompt({ id: 'p2', kind: 'system', title: 'Terse', tags: [] })],
      new Date('2026-01-01T00:00:00Z'),
    );
    expect(file).toMatchObject({
      format: 'command-center-prompts',
      version: 1,
      exportedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(parseLibraryFile(JSON.stringify(file))).toEqual(file.prompts);
  });

  it('refuses files that are not libraries, with a readable reason', () => {
    expect(() => parseLibraryFile('nope')).toThrow('not valid JSON');
    expect(() => parseLibraryFile('{"prompts":[]}')).toThrow('not a Command Center prompt library');
    expect(() =>
      parseLibraryFile('{"format":"command-center-prompts","version":99,"prompts":[]}'),
    ).toThrow('newer version');
    expect(() => parseLibraryFile('{"format":"command-center-prompts","version":1}')).toThrow(
      'no prompt list',
    );
  });

  it('validates every prompt and names the one that is wrong', () => {
    const bad = (item: unknown) =>
      parseLibraryFile(
        JSON.stringify({ format: 'command-center-prompts', version: 1, prompts: [prompt(), item] }),
      );
    expect(() => bad({ ...prompt(), id: '' })).toThrow('Prompt 2 has no id');
    expect(() => bad({ ...prompt(), kind: 'weird' })).toThrow('Prompt 2 has an unknown kind');
    expect(() => bad({ ...prompt(), title: '  ' })).toThrow('Prompt 2 has no title');
    expect(() => bad({ ...prompt(), body: 3 })).toThrow('Prompt 2 has no body');
    expect(() => bad({ ...prompt(), tags: [1] })).toThrow('Prompt 2 has invalid tags');
    expect(() => bad('x')).toThrow(LibraryFileError);
  });

  it('accepts a prompt without tags or timestamps', () => {
    const [p] = parseLibraryFile(
      JSON.stringify({
        format: 'command-center-prompts',
        version: 1,
        prompts: [{ id: 'a', kind: 'prompt', title: ' T ', body: '' }],
      }),
    );
    expect(p).toEqual({ id: 'a', kind: 'prompt', title: 'T', body: '', tags: [] });
  });
});

describe('tags', () => {
  it('trims, strips #, and drops case-insensitive duplicates', () => {
    expect(normalizeTags([' Code ', '#code', 'Rust', '', 'rust'])).toEqual(['Code', 'Rust']);
  });
  it('splits user input on commas and spaces', () => {
    expect(parseTagInput('review, #rust  style,')).toEqual(['review', 'rust', 'style']);
  });
});
