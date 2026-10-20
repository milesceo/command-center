import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import type { CustomModel } from '../../lib/repo-models';
import { useCustomModels } from '../../stores/custom-models';
import { useProviders } from '../../stores/providers';
import { AddModelDialog } from './AddModelDialog';
import { ModelCard } from './ModelCard';
import { ModelLab } from './ModelLab';
import { ModelSettingsForm } from './ModelSettingsForm';
import { ModelPresetsSettings } from './ModelPresetsSettings';

const SAMPLE: CustomModel[] = [
  {
    id: 'a',
    provider: 'local',
    model: 'hf.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF:Q4_K_M',
    displayName: 'Qwen2.5 0.5B Q4_K_M',
    hfRepo: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
    runtime: 'ollama',
    baseUrl: 'http://127.0.0.1:11434/v1',
    quant: 'Q4_K_M',
    filePath: null,
    adapterPath: null,
    systemPrompt: null,
    params: { temperature: 0.2 },
    tags: ['Fast'],
    createdAt: 0,
    updatedAt: 0,
  },
  {
    id: 'b',
    provider: 'huggingface',
    model: 'openai/gpt-oss-20b:fastest',
    displayName: 'GPT OSS 20B',
    hfRepo: 'openai/gpt-oss-20b',
    runtime: null,
    baseUrl: null,
    quant: null,
    filePath: null,
    adapterPath: null,
    systemPrompt: null,
    params: {},
    tags: [],
    createdAt: 0,
    updatedAt: 0,
  },
];

const RUNTIMES = [
  {
    id: 'ollama' as const,
    installed: true,
    running: true,
    baseUrl: 'http://127.0.0.1:11434/v1',
    models: [SAMPLE[0]!.model],
  },
  {
    id: 'llama.cpp' as const,
    installed: true,
    running: false,
    baseUrl: 'http://127.0.0.1:8080/v1',
    models: [],
  },
  {
    id: 'mlx' as const,
    installed: false,
    running: false,
    baseUrl: 'http://127.0.0.1:8081/v1',
    models: [],
  },
  {
    id: 'lmstudio' as const,
    installed: false,
    running: false,
    baseUrl: 'http://127.0.0.1:1234/v1',
    models: [],
  },
];

/** A stand-in for the Hugging Face Hub, so the stories work offline. */
const fakeHub: typeof fetch = (input) => {
  const url = new URL(String(input));
  const body = url.pathname.endsWith('/tree/main')
    ? [
        {
          type: 'file',
          path: 'qwen2.5-0.5b-instruct-q4_k_m.gguf',
          size: 1,
          lfs: { size: 491_000_000 },
        },
        {
          type: 'file',
          path: 'qwen2.5-0.5b-instruct-q8_0.gguf',
          size: 1,
          lfs: { size: 676_000_000 },
        },
      ]
    : url.pathname === '/api/models'
      ? [
          { id: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF', downloads: 120000, likes: 300, tags: ['gguf'] },
          {
            id: 'bartowski/Llama-3.2-1B-Instruct-GGUF',
            downloads: 90000,
            likes: 150,
            tags: ['gguf'],
          },
          { id: 'meta-llama/Llama-3.1-8B-Instruct', downloads: 5e6, likes: 4000, gated: 'manual' },
        ]
      : {
          id: 'Qwen/Qwen2.5-0.5B-Instruct-GGUF',
          pipeline_tag: 'text-generation',
          tags: ['gguf', 'conversational'],
          cardData: { license: 'apache-2.0' },
        };
  return Promise.resolve(new Response(JSON.stringify(body), { status: 200 }));
};

function WithModels({ models, children }: { models: CustomModel[]; children: React.ReactNode }) {
  useEffect(() => {
    useCustomModels.setState({ models, loaded: true, error: null });
    useProviders.setState((s) => ({
      infos: {
        ...s.infos,
        local: {
          id: 'local',
          name: 'On this computer',
          auth: 'signed_in',
          authMethods: [],
          note: '',
          models: [],
          runtimes: RUNTIMES,
        },
      },
    }));
  }, [models]);
  return <>{children}</>;
}

const meta = {
  title: 'Model Lab',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Lab: Story = {
  render: () => (
    <WithModels models={SAMPLE}>
      <ModelLab />
    </WithModels>
  ),
};

export const LabEmpty: Story = {
  render: () => (
    <WithModels models={[]}>
      <ModelLab />
    </WithModels>
  ),
};

export const Card: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <ul className="max-w-2xl">
      <ModelCard
        model={SAMPLE[0]!}
        selected
        serving
        onToggle={() => undefined}
        onChat={() => undefined}
        onEdit={() => undefined}
        onDelete={() => undefined}
        onDeleteChats={() => undefined}
        onRun={() => undefined}
      />
    </ul>
  ),
};

export const AddDialog: Story = {
  render: () => (
    <WithModels models={[]}>
      <AddModelDialog onClose={() => undefined} onAdded={() => undefined} fetchImpl={fakeHub} />
    </WithModels>
  ),
};

export const LabNarrow: Story = {
  render: () => (
    <WithModels models={SAMPLE}>
      <div className="w-[520px] border-r border-border">
        <ModelLab />
      </div>
    </WithModels>
  ),
};

export const SettingsForm: Story = {
  render: () => (
    <ModelSettingsForm
      model={{ ...SAMPLE[0]!, runtime: 'mlx', adapterPath: '/Users/you/adapters/lora' }}
      onSave={() => Promise.resolve()}
      onCancel={() => undefined}
    />
  ),
};

export const PresetsInSettings: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <WithModels models={SAMPLE}>
      <div className="flex max-w-xl flex-col gap-2">
        <ModelPresetsSettings />
      </div>
    </WithModels>
  ),
};
