import { describe, expect, it } from 'vitest';
import { AttachmentError, MAX_ATTACHMENT_BYTES, decodeText, readTextFile } from './attachments';

const file = (parts: BlobPart[], name: string) => new File(parts, name);

describe('decodeText', () => {
  it('accepts UTF-8 and rejects NUL bytes and invalid sequences', () => {
    expect(decodeText(new TextEncoder().encode('héllo ✓'))).toBe('héllo ✓');
    expect(decodeText(new Uint8Array([104, 0, 105]))).toBeNull();
    expect(decodeText(new Uint8Array([0xff, 0xfe, 0xfd]))).toBeNull();
  });
});

describe('readTextFile', () => {
  it('reads a source file', async () => {
    await expect(readTextFile(file(['let x = 1;'], 'a.ts'))).resolves.toEqual({
      name: 'a.ts',
      text: 'let x = 1;',
    });
  });
  it('rejects binary and oversized files with a readable message', async () => {
    await expect(readTextFile(file([new Uint8Array([0, 1, 2])], 'x.bin'))).rejects.toThrow(
      AttachmentError,
    );
    await expect(
      readTextFile(file(['a'.repeat(MAX_ATTACHMENT_BYTES + 1)], 'big.txt')),
    ).rejects.toThrow('larger than');
  });
});
