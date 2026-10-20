// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { conversationsStore } from '../../stores/conversations';
import { DEFAULT_SETTINGS, type Conversation } from '../../lib/types';
import { ErrorNotice } from './ErrorNotice';

const error = { code: 'overloaded', message: 'HTTP 500' } as const;

const activate = (provider: Conversation['provider']) =>
  conversationsStore.setState({
    activeId: 'c1',
    conversations: [
      {
        ...DEFAULT_SETTINGS,
        provider,
        id: 'c1',
        title: 't',
        pinned: false,
        createdAt: 0,
        updatedAt: 0,
      },
    ],
  });

afterEach(cleanup);

describe('ErrorNotice', () => {
  it("uses the local engine wording when the active chat's provider is local", () => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
    activate('local');
    render(<ErrorNotice error={error} />);
    const text = screen.getByRole('alert').textContent;
    expect(text).toContain("The local model engine isn't working");
    expect(text).toContain('Ollama from the menu bar');
  });

  it('keeps the Claude wording for a Claude chat', () => {
    activate('claude');
    render(<ErrorNotice error={error} />);
    expect(screen.getByRole('alert').textContent).toContain('Claude is overloaded');
  });
});
