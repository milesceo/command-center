// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({
  db: undefined as unknown as Db,
  saved: [] as { name: string; text: string }[],
}));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));
vi.mock('../../lib/save-file', () => ({
  saveTextFile: (name: string, text: string) => {
    hoisted.saved.push({ name, text });
    return Promise.resolve(true);
  },
}));

import * as repo from '../../lib/repo';
import * as plans from '../../lib/repo-plans';
import * as prompts from '../../lib/repo-prompts';
import { DEFAULT_SETTINGS } from '../../lib/types';
import { useCustomModels } from '../../stores/custom-models';
import { usePlans } from '../../stores/plans';
import { useSettings } from '../../stores/settings';
import { usePrefs } from '../../stores/prefs';
import { SettingsView } from './SettingsView';

beforeEach(async () => {
  hoisted.db = createTestDb();
  hoisted.saved = [];
  useSettings.getState().reset();
  const chat = await repo.createConversation(hoisted.db, { ...DEFAULT_SETTINGS });
  await repo.renameConversation(hoisted.db, chat.id, 'Keep me?');
  await prompts.createPrompt(hoisted.db, { kind: 'prompt', title: 'P', tags: [], body: 'b' });
});
afterEach(cleanup);

describe('SettingsView', () => {
  it('shows what is stored', async () => {
    render(<SettingsView />);
    await waitFor(() =>
      expect(screen.getByTestId('data-counts').textContent).toContain('1 conversations'),
    );
    expect(screen.getByTestId('data-counts').textContent).toContain('1 prompts');
    expect(screen.getByText(/Browser storage/)).toBeTruthy();
  });

  it('changes theme, sizes and new-chat defaults', async () => {
    render(<SettingsView />);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Theme' })).getByRole('button', { name: 'Light' }),
    );
    expect(usePrefs.getState().prefs.appearance.theme).toBe('light');
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Font size' })).getByRole('button', {
        name: 'Large',
      }),
    );
    expect(usePrefs.getState().prefs.appearance.fontScale).toBe(110);
    fireEvent.click(
      within(screen.getByRole('group', { name: 'Code font size' })).getByRole('button', {
        name: '14',
      }),
    );
    expect(useSettings.getState().codeFontSize).toBe(14);
    fireEvent.change(screen.getByLabelText('Default model'), { target: { value: 'sonnet' } });
    expect(useSettings.getState().defaultModel).toBe('sonnet');
    fireEvent.change(screen.getByLabelText(/Default system prompt/), {
      target: { value: 'Terse.' },
    });
    expect(useSettings.getState().defaultSystemPrompt).toBe('Terse.');
  });

  it('exports every table as JSON', async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: /Export all data/ }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    const file = JSON.parse(hoisted.saved[0]?.text ?? '');
    expect(hoisted.saved[0]?.name).toBe('command-center-data.json');
    expect(file.format).toBe('command-center-data');
    expect(file.tables.conversations[0].title).toBe('Keep me?');
  });

  it('clearing needs a confirmation, and cancelling deletes nothing', async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all data' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog.textContent).toContain('cannot be undone');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect((await repo.listConversations(hoisted.db)).length).toBe(1);
  });

  it('confirming clears the chosen data and refreshes the counts', async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear prompts and projects' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('data-counts').textContent).toContain('0 prompts'),
    );
    expect(screen.getByTestId('data-counts').textContent).toContain('1 conversations');

    fireEvent.click(screen.getByRole('button', { name: 'Clear all data' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('data-counts').textContent).toContain('0 conversations'),
    );
  });
});

describe('SettingsView and business plans', () => {
  beforeEach(async () => {
    // Harmless fixture only: the repository is public.
    await plans.createPlan(hoisted.db, {
      title: 'Test plan',
      html: '<p>fixture</p>',
      source: null,
    });
    await usePlans.getState().load();
    useCustomModels.setState({ models: [], loaded: false, error: null });
  });

  it('counts business plans', async () => {
    render(<SettingsView />);
    await waitFor(() =>
      expect(screen.getByTestId('data-counts').textContent).toContain('1 business plans'),
    );
  });

  it('names business plans in the Clear all data confirmation', () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all data' }));
    expect(screen.getByRole('alertdialog').textContent).toContain('business plans');
  });

  it('Clear all data empties the Business plans list and reloads Model Lab models', async () => {
    expect(usePlans.getState().plans).toHaveLength(1);
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear all data' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('data-counts').textContent).toContain('0 business plans'),
    );
    expect(await plans.listPlans(hoisted.db)).toEqual([]);
    expect(usePlans.getState().plans).toEqual([]);
    expect(usePlans.getState().selectedId).toBeNull();
    expect(useCustomModels.getState().loaded).toBe(true);
  });

  it('clearing prompts and projects keeps business plans', async () => {
    render(<SettingsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Clear prompts and projects' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() =>
      expect(screen.getByTestId('data-counts').textContent).toContain('0 prompts'),
    );
    expect(screen.getByTestId('data-counts').textContent).toContain('1 business plans');
    expect(usePlans.getState().plans.map((p) => p.title)).toEqual(['Test plan']);
  });
});

describe('SettingsView platform wording', () => {
  const setPlatform = (value: string) =>
    Object.defineProperty(navigator, 'platform', { configurable: true, value });
  afterEach(() => setPlatform(''));

  it('keeps the Windows wording and Ctrl+Shift+Q off macOS', () => {
    setPlatform('Win32');
    const { container } = render(<SettingsView />);
    const text = container.textContent ?? '';
    expect(text).toContain(
      'Start at login, what the close button does, and when the AI helper stops.',
    );
    expect(text).toContain('API keys live in the Windows Credential Manager.');
    expect(text).toContain('Keys stay in the Windows Credential Manager.');
    expect(text).toContain('GitHub issue reports. Ctrl+Shift+Q.');
    expect(text).not.toContain('Keychain');
  });

  it('names the Keychain and Cmd+Shift+Y on macOS, and never Windows', () => {
    setPlatform('MacIntel');
    const { container } = render(<SettingsView />);
    const text = container.textContent ?? '';
    expect(text).toContain('API keys live in the macOS Keychain.');
    expect(text).toContain('Keys stay in the macOS Keychain.');
    expect(text).toContain('GitHub issue reports. ⇧⌘Y.');
    expect(text).not.toContain('Ctrl+Shift+Q');
    expect(text).not.toMatch(/Windows/);
  });
});
