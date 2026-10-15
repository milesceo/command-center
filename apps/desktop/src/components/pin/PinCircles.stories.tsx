import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { PinCircles } from './PinCircles';

interface Args {
  initial: string;
  disabled: boolean;
  revealed: boolean;
  shake: number;
}

function Demo({ initial, disabled, revealed, shake }: Args) {
  const [value, setValue] = useState(initial);
  const [reveal, setReveal] = useState(revealed);
  return (
    <PinCircles
      value={value}
      onChange={setValue}
      label="PIN"
      disabled={disabled}
      shake={shake}
      reveal={reveal}
      onRevealChange={setReveal}
    />
  );
}

const meta = {
  title: 'PIN/PinCircles',
  component: Demo,
  args: { initial: '', disabled: false, revealed: false, shake: 0 },
  argTypes: {
    initial: { control: 'text', description: 'Characters already entered (up to 8).' },
    shake: {
      control: { type: 'number', min: 0, max: 99 },
      description: 'Raise to replay the shake.',
    },
  },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};
export const ThreeEntered: Story = { args: { initial: 'k3#' } };
export const MinimumReached: Story = { args: { initial: 'k3#Z' } };
export const Full: Story = { args: { initial: 'k3#Zp9!x' } };
export const Revealed: Story = { args: { initial: 'k3#Zp9', revealed: true } };
export const LockedOut: Story = { args: { initial: '', disabled: true } };
export const WrongPinShake: Story = { args: { initial: '', shake: 1 } };
