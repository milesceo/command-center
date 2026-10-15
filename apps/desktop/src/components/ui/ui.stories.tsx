import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { Button } from './button';
import { Segmented } from './segmented';
import { Switch } from './switch';

const meta = {
  title: 'UI/Primitives',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const Buttons: Story = {
  render: () => (
    <div className="flex flex-col gap-4">
      {(['primary', 'secondary', 'ghost'] as const).map((variant) => (
        <div key={variant} className="flex items-center gap-3">
          <span className="w-20 font-mono text-[11px] text-fg-subtle">{variant}</span>
          <Button variant={variant} size="sm">
            Small
          </Button>
          <Button variant={variant}>Medium</Button>
          <Button variant={variant} disabled>
            Disabled
          </Button>
        </div>
      ))}
    </div>
  ),
};

function SegmentedDemo() {
  const [value, setValue] = useState<'dark' | 'light' | 'system'>('dark');
  return (
    <Segmented
      label="Theme"
      value={value}
      options={[
        { value: 'dark', label: 'Dark' },
        { value: 'light', label: 'Light' },
        { value: 'system', label: 'System' },
      ]}
      onChange={setValue}
    />
  );
}

export const SegmentedControl: Story = { render: () => <SegmentedDemo /> };

function SwitchDemo() {
  const [on, setOn] = useState(true);
  return (
    <div className="flex items-center gap-4">
      <Switch label="Example switch" checked={on} onChange={setOn} />
      <Switch label="Off switch" checked={false} onChange={() => undefined} />
      <Switch label="Disabled switch" checked disabled onChange={() => undefined} />
    </div>
  );
}

export const Switches: Story = { render: () => <SwitchDemo /> };
