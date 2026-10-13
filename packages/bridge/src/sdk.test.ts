import { describe, expect, it } from 'vitest';
import { moduleSpecifier } from './sdk';

describe('moduleSpecifier', () => {
  it('turns absolute paths into file URLs and leaves package names alone', () => {
    expect(moduleSpecifier('/tmp/fake-sdk.mjs')).toBe('file:///tmp/fake-sdk.mjs');
    expect(moduleSpecifier('@anthropic-ai/claude-agent-sdk')).toBe(
      '@anthropic-ai/claude-agent-sdk',
    );
    expect(moduleSpecifier('some-package')).toBe('some-package');
  });

  it('recognises Windows drive paths even when run on another platform', () => {
    // Without this, `import('D:\\a\\fake-sdk.mjs')` fails with ERR_UNSUPPORTED_ESM_URL_SCHEME.
    expect(moduleSpecifier('D:\\a\\fake-sdk.mjs')).toMatch(/^file:\/\//);
    expect(moduleSpecifier('C:/a/fake-sdk.mjs')).toMatch(/^file:\/\//);
  });
});
