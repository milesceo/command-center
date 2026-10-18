// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
// The Hud loads usage from SQLite on mount.
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

const { BridgeStatus, DOT, LABEL } = await import('./BridgeStatus');
const { Hud } = await import('../../ide/shared/Hud');
const { useBridgeStore } = await import('../../stores/bridge');

beforeEach(() => {
  hoisted.db = createTestDb();
  useBridgeStore.setState({ status: 'idle', lastPing: null, error: null });
});
afterEach(cleanup);

describe('BridgeStatus', () => {
  it('calls a bridge that is not running "on standby" and says when it starts', () => {
    render(<BridgeStatus />);
    const button = screen.getByRole('button', { name: /Bridge on standby/ });
    expect(button.getAttribute('title')).toBe('Bridge on standby: starts on the next chat');
    expect(LABEL.idle).toBe('Bridge on standby');
  });

  it('prefers the error text in the title', () => {
    useBridgeStore.setState({ status: 'error', error: 'The Claude bridge process stopped.' });
    render(<BridgeStatus />);
    const button = screen.getByRole('button', { name: /Bridge error/ });
    expect(button.getAttribute('title')).toBe('The Claude bridge process stopped.');
  });

  it('uses the plain label as the title for the other states', () => {
    useBridgeStore.setState({ status: 'connecting' });
    render(<BridgeStatus />);
    expect(screen.getByRole('button').getAttribute('title')).toBe('Connecting…');
  });
});

describe('Hud bridge indicator', () => {
  for (const status of ['idle', 'connecting', 'ready', 'error', 'unavailable'] as const) {
    it(`uses the shared label and dot for ${status}`, () => {
      useBridgeStore.setState({ status });
      render(<Hud />);
      const indicator = screen.getByTestId('hud').querySelector(`[title="${LABEL[status]}"]`);
      expect(indicator).not.toBeNull();
      const dot = indicator?.querySelector('span');
      for (const cls of DOT[status].split(' ')) expect(dot?.classList.contains(cls)).toBe(true);
    });
  }
});
