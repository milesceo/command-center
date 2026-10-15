import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { LockScreen } from '../lock/LockScreen';
import { Splash } from '../splash/Splash';
import { AppearanceControls } from '../prefs/AppearanceControls';
import { PerformanceControls } from '../prefs/PerformanceControls';
import { PinSetup } from '../prefs/PinSetup';
import { ProviderCards } from '../prefs/ProviderCards';
import { SystemControls } from '../prefs/SystemControls';
import { usePrefs } from '../../stores/prefs';
import { OnboardingFlow } from './OnboardingFlow';

/** Opens the onboarding flow on a given step (the flow reads the saved step on mount). */
function OnStep({ step }: { step: number }) {
  useEffect(() => {
    usePrefs.getState().setOnboardingStep(step);
  }, [step]);
  return <OnboardingFlow key={step} />;
}

const meta = {
  title: 'Screens',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const OnboardingName: Story = { render: () => <OnStep step={0} /> };
export const OnboardingPin: Story = { render: () => <OnStep step={1} /> };
export const OnboardingSystem: Story = { render: () => <OnStep step={2} /> };
export const OnboardingLookAndFeel: Story = { render: () => <OnStep step={3} /> };
export const OnboardingAgents: Story = { render: () => <OnStep step={4} /> };
export const PinLock: Story = { render: () => <LockScreen /> };
export const SplashScreen: Story = { render: () => <Splash /> };

// Individual settings sections, for tuning one piece at a time.
export const SectionPerformance: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="max-w-xl">
      <PerformanceControls />
    </div>
  ),
};
export const SectionAppearance: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="max-w-xl">
      <AppearanceControls />
    </div>
  ),
};
export const SectionSystem: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="max-w-xl">
      <SystemControls />
    </div>
  ),
};
export const SectionPinSetup: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="max-w-md">
      <PinSetup onChange={() => undefined} />
    </div>
  ),
};
export const SectionProviders: Story = {
  parameters: { layout: 'padded' },
  render: () => (
    <div className="max-w-3xl">
      <ProviderCards />
    </div>
  ),
};
