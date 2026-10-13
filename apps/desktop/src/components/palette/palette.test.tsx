// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

import * as repo from '../../lib/repo';
import { DEFAULT_SETTINGS } from '../../lib/types';
import { useComposerStore } from '../../stores/composer';
import { conversationsStore } from '../../stores/conversations';
import { promptsStore } from '../../stores/prompts';
import { useUiStore } from '../../stores/ui';
import { CommandPalette } from './CommandPalette';

beforeEach(async () => {
  hoisted.db = createTestDb();
  promptsStore.setState({ prompts: [], loaded: true, error: null });
  conversationsStore.setState({ activeId: null, draft: { ...DEFAULT_SETTINGS } });
  useComposerStore.setState({ pending: null });
  useUiStore.setState({ paletteOpen: false, view: 'chat', sidebarOpen: true });
});
afterEach(cleanup);

const open = async () => {
  render(<CommandPalette />);
  await act(async () => useUiStore.getState().setPaletteOpen(true));
  return screen.getByRole('combobox');
};

describe('CommandPalette', () => {
  it('renders nothing until opened, then focuses the search box', async () => {
    render(<CommandPalette />);
    expect(screen.queryByRole('dialog')).toBeNull();
    await act(async () => useUiStore.getState().setPaletteOpen(true));
    const box = screen.getByRole('combobox');
    expect(screen.getByRole('dialog', { name: 'Command palette' })).toBeTruthy();
    expect(document.activeElement).toBe(box);
  });

  it('filters, moves with the arrow keys and runs the chosen command with Enter', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'settings' } });
    expect(screen.getAllByRole('option')[0]?.textContent).toContain('Open settings');
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(useUiStore.getState().view).toBe('settings'));
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('arrow keys change the active option and wrap around', async () => {
    const box = await open();
    const first = screen.getAllByRole('option')[0] as HTMLElement;
    expect(first.getAttribute('aria-selected')).toBe('true');
    expect(box.getAttribute('aria-activedescendant')).toBe(first.id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    const options = screen.getAllByRole('option');
    expect(options.at(-1)?.getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(options[0]?.getAttribute('aria-selected')).toBe('true');
  });

  it('Escape closes it', async () => {
    const box = await open();
    fireEvent.keyDown(box, { key: 'Escape' });
    expect(useUiStore.getState().paletteOpen).toBe(false);
  });

  it('says so when nothing matches', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'qqqqq' } });
    expect(screen.getByText(/Nothing matches/)).toBeTruthy();
    expect(screen.queryAllByRole('option')).toHaveLength(0);
  });

  it('switches model for the draft chat', async () => {
    const box = await open();
    fireEvent.change(box, { target: { value: 'model: opus' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(conversationsStore.getState().draft.model).toBe('opus'));
  });

  it('lists conversations from the database and opens one', async () => {
    const chat = await repo.createConversation(hoisted.db, { ...DEFAULT_SETTINGS });
    await repo.renameConversation(hoisted.db, chat.id, 'Fix the flaky test');
    useUiStore.getState().setView('usage');
    const box = await open();
    fireEvent.change(box, { target: { value: 'flaky' } });
    await waitFor(() =>
      expect(screen.getAllByRole('option')[0]?.textContent).toContain('Fix the flaky test'),
    );
    fireEvent.keyDown(box, { key: 'Enter' });
    await waitFor(() => expect(conversationsStore.getState().activeId).toBe(chat.id));
    expect(useUiStore.getState().view).toBe('chat');
  });

  it('inserts a saved prompt into the composer, asking for variables first', async () => {
    await act(async () => {
      await promptsStore
        .getState()
        .create({ kind: 'prompt', title: 'Review', tags: ['code'], body: 'Review {{lang}}' });
    });
    const box = await open();
    fireEvent.change(box, { target: { value: 'insert prompt: review' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    const field = await screen.findByLabelText('lang');
    fireEvent.change(field, { target: { value: 'Go' } });
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(useComposerStore.getState().pending?.text).toBe('Review Go');
  });

  it('keeps Tab inside the palette', async () => {
    const box = await open();
    fireEvent.keyDown(box, { key: 'Tab' });
    expect(screen.getByRole('dialog').contains(document.activeElement)).toBe(true);
  });
});
