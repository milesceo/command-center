// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
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

import { useComposerStore } from '../../stores/composer';
import { promptsStore } from '../../stores/prompts';
import { useToastStore } from '../../stores/toast';
import { useUiStore } from '../../stores/ui';
import { VariablesForm } from './VariablesForm';
import { PromptsView } from './PromptsView';

beforeEach(async () => {
  hoisted.db = createTestDb();
  hoisted.saved = [];
  promptsStore.setState({ prompts: [], loaded: false, error: null });
  useComposerStore.setState({ pending: null });
  useToastStore.setState({ toasts: [] });
  await promptsStore.getState().load();
});
afterEach(cleanup);

describe('VariablesForm', () => {
  it('asks for each variable, previews the result and submits the values', () => {
    const onSubmit = vi.fn();
    render(
      <VariablesForm
        title="Review"
        body="Review {{language}}: {{code}}"
        variables={['language', 'code']}
        confirmLabel="Insert"
        onSubmit={onSubmit}
        onCancel={() => {}}
      />,
    );
    fireEvent.change(screen.getByLabelText('language'), { target: { value: 'Rust' } });
    fireEvent.change(screen.getByLabelText('code'), { target: { value: 'fn main() {}' } });
    expect(screen.getByTestId('variables-preview').textContent).toBe('Review Rust: fn main() {}');
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(onSubmit).toHaveBeenCalledWith({ language: 'Rust', code: 'fn main() {}' });
  });

  it('Ctrl+Enter confirms, Escape cancels, blanks stay empty', () => {
    const onSubmit = vi.fn();
    const onCancel = vi.fn();
    render(
      <VariablesForm
        title="T"
        body="{{a}}"
        variables={['a']}
        initial={{ a: 'seed' }}
        confirmLabel="Go"
        onSubmit={onSubmit}
        onCancel={onCancel}
      />,
    );
    fireEvent.keyDown(screen.getByLabelText('a'), { key: 'Enter', ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledWith({ a: 'seed' });
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
  });
});

const add = (over = {}) =>
  act(async () => {
    await promptsStore.getState().create({
      kind: 'prompt',
      title: 'Code review',
      tags: ['review'],
      body: 'Review {{language}} code',
      ...over,
    });
  });

describe('PromptsView', () => {
  it('shows an empty state, then creates a prompt through the editor', async () => {
    render(<PromptsView />);
    expect(screen.getByText(/No saved prompts yet/)).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'New prompt' }));
    const editor = screen.getByRole('dialog', { name: 'New prompt' });
    const save = within(editor).getByRole('button', { name: 'Save' }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(within(editor).getByLabelText('Title'), { target: { value: 'Explain' } });
    fireEvent.change(within(editor).getByLabelText('Tags'), {
      target: { value: 'learn, Learn, docs' },
    });
    fireEvent.change(within(editor).getByLabelText(/^Body/), {
      target: { value: 'Explain {{topic}}' },
    });
    expect(within(editor).getByLabelText('Variables', { selector: 'div' }).textContent).toContain(
      'topic',
    );
    fireEvent.click(save);

    await waitFor(() => expect(screen.getAllByTestId('prompt-item')).toHaveLength(1));
    expect(promptsStore.getState().prompts[0]).toMatchObject({
      title: 'Explain',
      tags: ['learn', 'docs'],
      body: 'Explain {{topic}}',
    });
  });

  it('edits and deletes (after confirming)', async () => {
    await add();
    render(<PromptsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit Code review' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Code review v2' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    await screen.findByText('Code review v2');

    fireEvent.click(screen.getByRole('button', { name: 'Delete Code review v2' }));
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getAllByTestId('prompt-item')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Delete Code review v2' }));
    fireEvent.click(
      within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete' }),
    );
    await waitFor(() => expect(screen.queryAllByTestId('prompt-item')).toHaveLength(0));
  });

  it('searches, filters by kind and by tag', async () => {
    await add();
    await add({ kind: 'system', title: 'Pirate', tags: ['fun'], body: 'Arr' });
    render(<PromptsView />);
    expect(screen.getAllByTestId('prompt-item')).toHaveLength(2);

    fireEvent.change(screen.getByLabelText('Search prompts'), { target: { value: 'pira' } });
    expect(screen.getAllByTestId('prompt-item')).toHaveLength(1);
    fireEvent.change(screen.getByLabelText('Search prompts'), { target: { value: '' } });

    fireEvent.click(screen.getByRole('button', { name: 'System prompts' }));
    expect(screen.getAllByTestId('prompt-item')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'All' }));

    fireEvent.click(screen.getByRole('button', { name: '#review' }));
    expect(screen.getAllByTestId('prompt-item')).toHaveLength(1);
    expect(screen.getByText('Code review')).toBeTruthy();
  });

  it('inserting a prompt with variables asks first, then hands the text to the composer', async () => {
    await add({ body: 'Review {{language}} code' });
    useUiStore.getState().setView('prompts');
    render(<PromptsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    fireEvent.change(screen.getByLabelText('language'), { target: { value: 'Go' } });
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Insert' }));
    expect(useComposerStore.getState().pending?.text).toBe('Review Go code');
    expect(useUiStore.getState().view).toBe('chat');
  });

  it('inserting a prompt without variables needs no form', async () => {
    await add({ body: 'Plain text' });
    render(<PromptsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Insert' }));
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(useComposerStore.getState().pending?.text).toBe('Plain text');
  });

  it('exports the library as JSON', async () => {
    await add();
    render(<PromptsView />);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(hoisted.saved).toHaveLength(1));
    expect(hoisted.saved[0]?.name).toBe('command-center-prompts.json');
    expect(JSON.parse(hoisted.saved[0]?.text ?? '')).toMatchObject({
      format: 'command-center-prompts',
      prompts: [{ title: 'Code review', tags: ['review'] }],
    });
  });

  it('imports a library file and reports what changed; a bad file changes nothing', async () => {
    await add();
    const exported = promptsStore.getState().exportJson();
    await act(async () => {
      await promptsStore.getState().remove(promptsStore.getState().prompts[0]!.id);
    });
    render(<PromptsView />);
    const input = screen.getByTestId('import-input');
    const file = (text: string) => new File([text], 'lib.json', { type: 'application/json' });

    fireEvent.change(input, { target: { files: [file(exported)] } });
    await waitFor(() => expect(screen.getAllByTestId('prompt-item')).toHaveLength(1));
    expect(useToastStore.getState().toasts.at(-1)?.message).toBe(
      'Imported: 1 added, 0 updated, 0 skipped',
    );

    fireEvent.change(input, { target: { files: [file('{"format":"nope"}')] } });
    await waitFor(() => expect(useToastStore.getState().toasts.length).toBeGreaterThan(1));
    expect(screen.getAllByTestId('prompt-item')).toHaveLength(1);
  });
});
