import { LEGACY_LIBRARY_FORMATS } from './legacy';
import type { Prompt, PromptKind } from './types';

/** JSON file format for exporting and importing the prompt library. */
export const LIBRARY_FORMAT = 'command-center-prompts';
export const LIBRARY_VERSION = 1;

export interface LibraryFile {
  format: typeof LIBRARY_FORMAT;
  version: number;
  exportedAt: string;
  prompts: LibraryPrompt[];
}

export interface LibraryPrompt {
  id: string;
  kind: PromptKind;
  title: string;
  body: string;
  tags: string[];
  createdAt?: number;
  updatedAt?: number;
}

export function buildLibraryFile(prompts: Prompt[], now = new Date()): LibraryFile {
  return {
    format: LIBRARY_FORMAT,
    version: LIBRARY_VERSION,
    exportedAt: now.toISOString(),
    prompts: prompts.map((p) => ({
      id: p.id,
      kind: p.kind,
      title: p.title,
      body: p.body,
      tags: p.tags,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  };
}

export class LibraryFileError extends Error {}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);
const MAX_PROMPTS = 5000;

/**
 * Validates an imported file. Anything unexpected is a clear error rather than a
 * half-import: the file is either a library this app understands, or it is refused.
 */
export function parseLibraryFile(text: string): LibraryPrompt[] {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new LibraryFileError('That file is not valid JSON.');
  }
  if (
    !isObject(raw) ||
    (raw.format !== LIBRARY_FORMAT &&
      !(typeof raw.format === 'string' && LEGACY_LIBRARY_FORMATS.includes(raw.format)))
  ) {
    throw new LibraryFileError('That file is not a Command Center prompt library.');
  }
  if (typeof raw.version !== 'number' || raw.version > LIBRARY_VERSION) {
    throw new LibraryFileError('That library was made by a newer version of Command Center.');
  }
  if (!Array.isArray(raw.prompts)) throw new LibraryFileError('The library has no prompt list.');
  if (raw.prompts.length > MAX_PROMPTS)
    throw new LibraryFileError(`The library has more than ${MAX_PROMPTS} prompts.`);

  return raw.prompts.map((item, index): LibraryPrompt => {
    const where = `Prompt ${index + 1}`;
    if (!isObject(item)) throw new LibraryFileError(`${where} is not an object.`);
    if (typeof item.id !== 'string' || item.id === '')
      throw new LibraryFileError(`${where} has no id.`);
    if (item.kind !== 'prompt' && item.kind !== 'system')
      throw new LibraryFileError(`${where} has an unknown kind.`);
    if (typeof item.title !== 'string' || item.title.trim() === '')
      throw new LibraryFileError(`${where} has no title.`);
    if (typeof item.body !== 'string') throw new LibraryFileError(`${where} has no body.`);
    const tags = item.tags === undefined ? [] : item.tags;
    if (!Array.isArray(tags) || tags.some((t) => typeof t !== 'string'))
      throw new LibraryFileError(`${where} has invalid tags.`);
    const prompt: LibraryPrompt = {
      id: item.id,
      kind: item.kind,
      title: item.title.trim(),
      body: item.body,
      tags: normalizeTags(tags as string[]),
    };
    if (typeof item.createdAt === 'number') prompt.createdAt = item.createdAt;
    if (typeof item.updatedAt === 'number') prompt.updatedAt = item.updatedAt;
    return prompt;
  });
}

/** Trimmed, lowercase-insensitive de-duplicated tags (first spelling wins). */
export function normalizeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of tags) {
    const tag = raw.trim().replace(/^#/, '');
    if (!tag || seen.has(tag.toLowerCase())) continue;
    seen.add(tag.toLowerCase());
    out.push(tag);
  }
  return out;
}

/** "a, b  c" -> ['a','b','c'] (commas or whitespace separate tags). */
export function parseTagInput(input: string): string[] {
  return normalizeTags(input.split(/[,\s]+/));
}
