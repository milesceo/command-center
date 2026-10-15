import type { Attachment } from '@geeked/protocol';

export const MAX_ATTACHMENT_BYTES = 200 * 1024;
export const MAX_ATTACHMENTS = 10;

export class AttachmentError extends Error {}

/** UTF-8 text without NUL bytes; anything else (images, archives, binaries) is refused. */
export function decodeText(bytes: Uint8Array): string | null {
  if (bytes.includes(0)) return null;
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** Reads a dropped/pasted/picked file as a text attachment, or explains why not. */
export async function readTextFile(file: File): Promise<Attachment> {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new AttachmentError(`${file.name} is larger than ${MAX_ATTACHMENT_BYTES / 1024} KB.`);
  }
  const text = decodeText(new Uint8Array(await file.arrayBuffer()));
  if (text === null) throw new AttachmentError(`${file.name} does not look like a text file.`);
  return { name: file.name || 'pasted.txt', text };
}
