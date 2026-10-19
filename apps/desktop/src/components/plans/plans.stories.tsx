import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { usePlans } from '../../stores/plans';
import { BusinessPlansView } from './BusinessPlansView';

const meta = {
  title: 'Business plans',
  parameters: { layout: 'fullscreen' },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

/** The empty state (Storybook has no database, so adding a plan shows an error toast here). */
function Empty() {
  useEffect(() => {
    usePlans.setState({ plans: [], loaded: true, error: null, selectedId: null });
  }, []);
  return <BusinessPlansView />;
}

function LoadError() {
  useEffect(() => {
    usePlans.setState({ plans: [], loaded: true, error: 'database is locked', selectedId: null });
  }, []);
  return <BusinessPlansView />;
}

export const NoPlans: Story = {
  render: () => (
    <div className="h-[480px]">
      <Empty />
    </div>
  ),
};

export const ReadError: Story = {
  render: () => (
    <div className="h-[480px]">
      <LoadError />
    </div>
  ),
};
