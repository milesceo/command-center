import type { Meta, StoryObj } from '@storybook/react-vite';
import { AsciiLogo } from './AsciiLogo';
import { GeekedMark } from './GeekedMark';

const meta = {
  title: 'Brand/Logo',
  parameters: { layout: 'padded' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The splash logo: spins at the tier's frame rate (change Tier and Motion in the toolbar). */
export const SplashSpinning: Story = {
  render: () => (
    <div className="grid min-h-[320px] place-items-center">
      <AsciiLogo size="splash" />
    </div>
  ),
};

/** The Home corner logo: always one still frame. */
export const HomeCornerStill: Story = {
  render: () => <AsciiLogo size="corner" still />,
};

export const Mark: Story = {
  render: () => (
    <div className="flex items-end gap-6">
      {[40, 72, 120].map((size) => (
        <GeekedMark key={size} size={size} />
      ))}
    </div>
  ),
};
