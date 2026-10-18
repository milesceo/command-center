// @vitest-environment jsdom
import {
  PROVIDER_IDS,
  type BridgeEvent,
  type ChatRequest,
  type ProviderId,
} from '@command-center/protocol';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import type * as SystemModule from '../../lib/system';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({
  db: undefined as unknown as Db,
  chats: [] as { request: Omit<ChatRequest, 'type' | 'id'>; onEvent: (e: BridgeEvent) => void }[],
  runs: [] as unknown[],
  cancels: [] as ReturnType<typeof vi.fn>[],
  ensureBridge: (() => Promise.resolve()) as () => Promise<void>,
  memory: null as number | null,
}));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));
vi.mock('../../stores/bridge', () => ({ ensureBridge: () => hoisted.ensureBridge() }));
vi.mock('../../lib/system', async (importOriginal) => {
  const real = await importOriginal<typeof SystemModule>();
  return { ...real, system: { ...real.system, memory: () => Promise.resolve(hoisted.memory) } };
});
vi.mock('../../lib/bridge-client', () => ({
  getBridgeClient: () => ({
    chat: (request: Omit<ChatRequest, 'type' | 'id'>, onEvent: (e: BridgeEvent) => void) => {
      hoisted.chats.push({ request, onEvent });
      const cancel = vi.fn();
      hoisted.cancels.push(cancel);
      return { id: 'c', cancel, done: Promise.resolve() };
    },
    localRun: (request: unknown) => {
      hoisted.runs.push(request);
      return Promise.resolve([]);
    },
    providers: () => Promise.resolve([]),
  }),
}));

import * as repo from '../../lib/repo';
import { conversationsStore } from '../../stores/conversations';
import { customModelRef, useCustomModels } from '../../stores/custom-models';
import { useProviders } from '../../stores/providers';
import { useUiStore } from '../../stores/ui';
import { ProviderModelPicker } from '../chat/ProviderModelPicker';
import { AddModelDialog } from './AddModelDialog';
import { ModelLab } from './ModelLab';

const hub: typeof fetch = (input) => {
  const url = new URL(String(input));
  const body = url.pathname.endsWith('/tree/main')
    ? [
        { type: 'file', path: 'm-q8_0.gguf', size: 1, lfs: { size: 700_000_000 } },
        { type: 'file', path: 'm-q4_k_m.gguf', size: 1, lfs: { size: 400_000_000 } },
      ]
    : url.pathname === '/api/models'
      ? [{ id: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', downloads: 5, likes: 1, tags: ['gguf'] }]
      : {
          id: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
          pipeline_tag: 'text-generation',
          tags: ['gguf'],
          cardData: { license: 'apache-2.0' },
        };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
};

const localModel = {
  provider: 'local' as const,
  model: 'qwen2.5:0.5b',
  displayName: 'Tiny Qwen',
  hfRepo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
  runtime: 'ollama' as const,
  baseUrl: 'http://127.0.0.1:11434/v1',
  quant: 'Q4_K_M',
  filePath: null,
  adapterPath: null,
  systemPrompt: null,
  params: {},
  tags: [],
};

beforeEach(async () => {
  // A Mac: Run in Terminal is offered there only.
  Object.defineProperty(navigator, 'platform', { configurable: true, value: 'MacIntel' });
  hoisted.db = createTestDb();
  hoisted.chats = [];
  hoisted.runs = [];
  hoisted.cancels = [];
  hoisted.ensureBridge = () => Promise.resolve();
  hoisted.memory = null;
  useCustomModels.setState({ models: [], loaded: false, error: null });
  useProviders.setState({
    infos: {},
    hasKey: Object.fromEntries(PROVIDER_IDS.map((id) => [id, false])) as Record<
      ProviderId,
      boolean
    >,
    loading: false,
    error: null,
  });
  useUiStore.setState({ addModelOpen: false, view: 'models' });
  await useCustomModels.getState().load();
});
afterEach(cleanup);

describe('AddModelDialog', () => {
  it('looks up a pasted link, shows the exact command, runs it and saves the model', async () => {
    const onAdded = vi.fn();
    render(<AddModelDialog onClose={() => {}} onAdded={onAdded} fetchImpl={hub} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a link' }));
    fireEvent.change(screen.getByLabelText('Model id or link'), {
      target: { value: 'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/tree/main' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));

    const details = await screen.findByRole('region', { name: 'Model details' });
    expect(within(details).getByText(/License apache-2.0/)).toBeTruthy();
    // Q4_K_M is preselected and the command is the one the bridge would run.
    expect(
      within(details).getByText('ollama run hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M'),
    ).toBeTruthy();

    fireEvent.click(within(details).getByRole('button', { name: 'Run in Terminal' }));
    await waitFor(() =>
      expect(hoisted.runs).toEqual([
        {
          runtime: 'ollama',
          source: { kind: 'hf', repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', quant: 'Q4_K_M' },
        },
      ]),
    );

    fireEvent.click(within(details).getByRole('button', { name: /^Add / }));
    await waitFor(() => expect(onAdded).toHaveBeenCalled());
    expect(useCustomModels.getState().models[0]).toMatchObject({
      provider: 'local',
      model: 'hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M',
      displayName: 'Qwen2.5-0.5B-Instruct Q4_K_M',
    });
  });

  it('refuses links that are not Hugging Face and relative file paths', async () => {
    render(<AddModelDialog onClose={() => {}} onAdded={() => {}} fetchImpl={hub} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a link' }));
    fireEvent.change(screen.getByLabelText('Model id or link'), {
      target: { value: 'https://evil.example/a/b' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    expect(screen.getByRole('alert').textContent).toMatch(/owner\/name/);

    fireEvent.click(screen.getByRole('button', { name: 'From a file' }));
    fireEvent.change(screen.getByLabelText('Path to the model file or folder'), {
      target: { value: 'models/x.gguf' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Use path' }));
    expect(screen.getByRole('alert').textContent).toMatch(/full path/);
  });

  it('offers the cloud route and only that for a model with no GGUF or MLX files', async () => {
    const plain: typeof fetch = (input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).endsWith('/tree/main')
              ? [{ type: 'file', path: 'model.safetensors', size: 10 }]
              : { id: 'openai/gpt-oss-20b', pipeline_tag: 'text-generation', tags: [] },
          ),
        ),
      );
    render(<AddModelDialog onClose={() => {}} onAdded={() => {}} fetchImpl={plain} />);
    fireEvent.click(screen.getByRole('button', { name: 'Paste a link' }));
    fireEvent.change(screen.getByLabelText('Model id or link'), {
      target: { value: 'openai/gpt-oss-20b:fastest' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
    const details = await screen.findByRole('region', { name: 'Model details' });
    const where = within(details).getByRole('group', { name: 'Where it runs' });
    expect(
      within(where)
        .getAllByRole('button')
        .map((b) => b.textContent),
    ).toEqual(['Hugging Face cloud']);
    // No token yet: the dialog says where to add one.
    expect(within(details).getByText(/access token in Settings/)).toBeTruthy();
  });
});

describe('ModelLab', () => {
  it('shows an empty state that opens the add dialog', async () => {
    render(<ModelLab />);
    expect(await screen.findByText('No models yet')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Add a model' })[1]!);
    expect(useUiStore.getState().addModelOpen).toBe(true);
  });

  it('tests the ticked models side by side with measured numbers', async () => {
    await useCustomModels.getState().add(localModel);
    render(<ModelLab />);
    fireEvent.click(await screen.findByLabelText('Include Tiny Qwen in the test'));
    fireEvent.change(screen.getByLabelText('Test prompt'), { target: { value: 'Hi' } });
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(hoisted.chats).toHaveLength(1));
    expect(hoisted.chats[0]!.request).toMatchObject({
      provider: 'local',
      model: 'qwen2.5:0.5b',
      baseUrl: 'http://127.0.0.1:11434/v1',
      messages: [{ role: 'user', content: 'Hi' }],
    });
    const emit = hoisted.chats[0]!.onEvent;
    emit({ type: 'chat.text', id: 'c', text: 'Hello there' });
    emit({
      type: 'chat.done',
      id: 'c',
      status: 'completed',
      usage: {
        inputTokens: 3,
        outputTokens: 4,
        cacheReadTokens: 0,
        cacheCreationTokens: 0,
        models: [],
      },
    });
    const card = await screen.findByRole('article', { name: 'Tiny Qwen' });
    // Events are applied once per animation frame.
    expect(await within(card).findByText('Hello there')).toBeTruthy();
    expect(within(card).getByText('7')).toBeTruthy();
    expect(within(card).getByRole('button', { name: 'Save to conversation' })).toBeTruthy();
  });

  it('starts a chat with the model and removes it after confirming', async () => {
    const m = await useCustomModels.getState().add(localModel);
    render(<ModelLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Chat with Tiny Qwen' }));
    await waitFor(() => expect(useUiStore.getState().view).toBe('chat'));
    expect(conversationsStore.getState().draft).toMatchObject({
      provider: 'local',
      model: customModelRef(m.id),
    });

    useUiStore.setState({ view: 'models' });
    fireEvent.click(screen.getByRole('button', { name: 'Remove Tiny Qwen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(useCustomModels.getState().models).toEqual([]));
  });
});

describe('ProviderModelPicker', () => {
  it('lists Model Lab models for the local provider', async () => {
    const m = await useCustomModels.getState().add(localModel);
    conversationsStore.getState().newChat();
    await conversationsStore.getState().updateSettings({ provider: 'local', model: null });
    render(<ProviderModelPicker />);
    const select = screen.getByLabelText('Model');
    expect(
      within(select)
        .getAllByRole('option')
        .map((o) => o.textContent),
    ).toEqual(['Choose a model', 'Tiny Qwen']);
    fireEvent.change(select, { target: { value: customModelRef(m.id) } });
    await waitFor(() =>
      expect(conversationsStore.getState().draft.model).toBe(customModelRef(m.id)),
    );
  });
});

const done = (status: 'completed' | 'cancelled'): BridgeEvent => ({
  type: 'chat.done',
  id: 'c',
  status,
  usage: {
    inputTokens: 1,
    outputTokens: 1,
    cacheReadTokens: 0,
    cacheCreationTokens: 0,
    models: [],
  },
});

/** Renders the Lab with Tiny Qwen ticked and a prompt typed. */
async function labWithPrompt(text: string) {
  await useCustomModels.getState().add(localModel);
  render(<ModelLab />);
  fireEvent.click(await screen.findByLabelText('Include Tiny Qwen in the test'));
  fireEvent.change(screen.getByLabelText('Test prompt'), { target: { value: text } });
}

describe('ModelTestPanel: stop and run again', () => {
  it('ignores the stopped run’s late events after a new run starts', async () => {
    await labWithPrompt('Hi');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(hoisted.chats).toHaveLength(1));
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(hoisted.cancels[0]).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Run' }));
    await waitFor(() => expect(hoisted.chats).toHaveLength(2));

    // The cancelled chat still answers until its terminal event; it arrives after Run again.
    hoisted.chats[0]!.onEvent({ type: 'chat.text', id: 'c', text: 'LATE from run one' });
    hoisted.chats[0]!.onEvent(done('cancelled'));
    hoisted.chats[1]!.onEvent({ type: 'chat.text', id: 'c', text: 'fresh' });

    const card = screen.getByRole('article', { name: 'Tiny Qwen' });
    expect(await within(card).findByText('fresh')).toBeTruthy();
    expect(within(card).queryByText(/LATE/)).toBeNull();
    // Still answering: the old cancelled done did not mark the new run stopped.
    expect(within(card).getByText('Answering…')).toBeTruthy();
    expect(card.getAttribute('aria-busy')).toBe('true');
    expect(screen.getByRole('button', { name: 'Stop' })).toBeTruthy();
  });

  it('starts no chat when Stop is pressed while the bridge is still starting', async () => {
    let release!: () => void;
    hoisted.ensureBridge = () => new Promise<void>((r) => (release = r));
    await labWithPrompt('Hi');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Stop' }));
    release();
    expect(await screen.findByRole('button', { name: 'Run' })).toBeTruthy();
    // Let the awaited bridge start (and the key read after it) settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));
    expect(hoisted.chats).toHaveLength(0);
    expect(
      within(screen.getByRole('article', { name: 'Tiny Qwen' })).getByText('Stopped'),
    ).toBeTruthy();
  });
});

describe('ModelTestPanel: save to conversation', () => {
  it('stores the prompt that produced the reply even after the box was edited', async () => {
    await labWithPrompt('Original prompt');
    fireEvent.click(screen.getByRole('button', { name: 'Run' }));
    await waitFor(() => expect(hoisted.chats).toHaveLength(1));
    hoisted.chats[0]!.onEvent({ type: 'chat.text', id: 'c', text: 'The reply' });
    hoisted.chats[0]!.onEvent(done('completed'));
    const card = screen.getByRole('article', { name: 'Tiny Qwen' });
    const save = await within(card).findByRole('button', { name: 'Save to conversation' });

    fireEvent.change(screen.getByLabelText('Test prompt'), {
      target: { value: 'Edited afterwards' },
    });
    fireEvent.click(save);
    await waitFor(() => expect(useUiStore.getState().view).toBe('chat'));

    const saved = (await repo.listConversations(hoisted.db)).find(
      (c) => c.title === 'Test: Tiny Qwen',
    );
    expect(saved).toBeTruthy();
    const messages = await repo.listMessages(hoisted.db, saved!.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Original prompt'],
      ['assistant', 'The reply'],
    ]);
  });
});

describe('ModelLab: Run in Terminal', () => {
  it('shows the command in a confirm dialog and runs only after confirming (macOS)', async () => {
    await useCustomModels.getState().add(localModel);
    render(<ModelLab />);
    fireEvent.click(await screen.findByRole('button', { name: 'Run Tiny Qwen in Terminal' }));
    const dialog = screen.getByRole('alertdialog', { name: 'Run Tiny Qwen in Terminal?' });
    expect(
      within(dialog).getByText('ollama run hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M'),
    ).toBeTruthy();
    expect(hoisted.runs).toEqual([]);

    // Cancel runs nothing.
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(hoisted.runs).toEqual([]);

    fireEvent.click(screen.getByRole('button', { name: 'Run Tiny Qwen in Terminal' }));
    fireEvent.click(screen.getByRole('button', { name: 'Open Terminal' }));
    await waitFor(() =>
      expect(hoisted.runs).toEqual([
        {
          runtime: 'ollama',
          source: { kind: 'hf', repo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', quant: 'Q4_K_M' },
        },
      ]),
    );
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });

  it('is not offered on Windows', async () => {
    Object.defineProperty(navigator, 'platform', { configurable: true, value: 'Win32' });
    await useCustomModels.getState().add(localModel);
    render(<ModelLab />);
    expect(await screen.findByRole('button', { name: 'Chat with Tiny Qwen' })).toBeTruthy();
    expect(screen.queryByRole('button', { name: 'Run Tiny Qwen in Terminal' })).toBeNull();
  });
});

describe('ProviderModelPicker: Model Lab providers', () => {
  const options = () =>
    within(screen.getByLabelText('Model')).getAllByRole('option') as HTMLOptionElement[];

  it('disables the placeholder for local and Hugging Face', async () => {
    await useCustomModels.getState().add(localModel);
    conversationsStore.getState().newChat();
    await conversationsStore.getState().updateSettings({ provider: 'local', model: null });
    render(<ProviderModelPicker />);
    expect(options()[0]).toMatchObject({ textContent: 'Choose a model', disabled: true });
    expect(options()[1]).toMatchObject({ textContent: 'Tiny Qwen', disabled: false });
    cleanup();

    // Hugging Face with nothing added yet: the hint is not a choice either.
    await conversationsStore.getState().updateSettings({ provider: 'huggingface', model: null });
    render(<ProviderModelPicker />);
    expect(options().map((o) => [o.textContent, o.disabled])).toEqual([
      ['Add one in the Model Lab', true],
    ]);
  });

  it('shows "Removed model" for a cm: model that no longer exists', async () => {
    conversationsStore.getState().newChat();
    await conversationsStore
      .getState()
      .updateSettings({ provider: 'local', model: customModelRef('gone-id') });
    render(<ProviderModelPicker />);
    const select = screen.getByLabelText('Model') as HTMLSelectElement;
    expect(select.value).toBe(customModelRef('gone-id'));
    expect(options().at(-1)?.textContent).toBe('Removed model');
    expect(screen.queryByText(customModelRef('gone-id'))).toBeNull();
  });

  it('shows no status dot for local models, but does for Hugging Face', async () => {
    conversationsStore.getState().newChat();
    await conversationsStore.getState().updateSettings({ provider: 'local', model: null });
    render(<ProviderModelPicker />);
    expect(screen.queryByRole('button', { name: /status:/ })).toBeNull();
    cleanup();
    await conversationsStore.getState().updateSettings({ provider: 'huggingface', model: null });
    render(<ProviderModelPicker />);
    expect(screen.getByRole('button', { name: /status:/ })).toBeTruthy();
  });
});

describe('AddModelDialog: warnings and search state', () => {
  const lookUp = (value: string) => {
    fireEvent.click(screen.getByRole('button', { name: 'Paste a link' }));
    fireEvent.change(screen.getByLabelText('Model id or link'), { target: { value } });
    fireEvent.click(screen.getByRole('button', { name: 'Look up' }));
  };

  it('shows no token hint for a cloud-only model when a token is stored', async () => {
    useProviders.setState((s) => ({ hasKey: { ...s.hasKey, huggingface: true } }));
    const plain: typeof fetch = (input) =>
      Promise.resolve(
        new Response(
          JSON.stringify(
            String(input).endsWith('/tree/main')
              ? [{ type: 'file', path: 'model.safetensors', size: 10 }]
              : { id: 'openai/gpt-oss-20b', pipeline_tag: 'text-generation', tags: [] },
          ),
        ),
      );
    render(<AddModelDialog onClose={() => {}} onAdded={() => {}} fetchImpl={plain} />);
    lookUp('openai/gpt-oss-20b');
    const details = await screen.findByRole('region', { name: 'Model details' });
    expect(within(details).getByText(/Inference Providers with your token/)).toBeTruthy();
    expect(within(details).queryByText(/access token/)).toBeNull();
  });

  it('warns in an amber box, not an alert, when the file is over 75% of memory', async () => {
    hoisted.memory = 8e9;
    const big: typeof fetch = (input) => {
      const url = new URL(String(input));
      const body = url.pathname.endsWith('/tree/main')
        ? [{ type: 'file', path: 'big-q4_k_m.gguf', size: 1, lfs: { size: 7e9 } }]
        : { id: 'a/Big-GGUF', pipeline_tag: 'text-generation', tags: ['gguf'] };
      return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
    };
    render(<AddModelDialog onClose={() => {}} onAdded={() => {}} fetchImpl={big} />);
    lookUp('a/Big-GGUF');
    const details = await screen.findByRole('region', { name: 'Model details' });
    const warning = await within(details).findByText(/larger than this computer can comfortably/);
    const box = warning.closest('li')!;
    expect(box.className).toMatch(/bg-warning\/15/);
    expect(box.hasAttribute('role')).toBe(false);
    expect(box.closest('[role="alert"],[role="status"]')).toBeNull();
    expect(within(details).queryByRole('alert')).toBeNull();
  });

  it('does not keep "Searching…" after the query is cleared', async () => {
    // A search that never answers and ignores the abort: the worst case for a stuck spinner.
    const hanging: typeof fetch = () => new Promise<Response>(() => {});
    render(<AddModelDialog onClose={() => {}} onAdded={() => {}} fetchImpl={hanging} />);
    const box = screen.getByLabelText('Search Hugging Face models');
    fireEvent.change(box, { target: { value: 'qwen' } });
    expect(await screen.findByText('Searching…')).toBeTruthy();
    fireEvent.change(box, { target: { value: '' } });
    expect(screen.queryByText('Searching…')).toBeNull();
    fireEvent.change(box, { target: { value: 'q' } });
    expect(screen.queryByText('Searching…')).toBeNull();
  });
});
