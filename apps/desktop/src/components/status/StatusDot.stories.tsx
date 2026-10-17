import type { FeedProvider, OverallStatus, StatusFeed } from '@command-center/protocol';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect } from 'react';
import { useStatus } from '../../stores/status';
import { StatusDot } from './StatusDot';

function claude(overall: OverallStatus, withIncident: boolean): FeedProvider {
  return {
    id: 'anthropic',
    name: 'Claude',
    vendor: 'Anthropic',
    geeked_provider: 'claude',
    models: { state: 'ok', source: '', error: null, items: [] },
    status: {
      state: 'ok',
      source: '',
      page_url: null,
      error: null,
      overall,
      summary: overall === 'operational' ? 'All Systems Operational' : 'Elevated error rates',
      incidents: withIncident
        ? [
            {
              id: 'i1',
              title: 'Elevated errors on Claude Code',
              status: 'investigating',
              impact: 'minor',
              url: 'https://status.claude.com',
              started_at: null,
              updated_at: null,
            },
          ]
        : [],
      affected_components: withIncident
        ? [{ name: 'Claude Code', status: 'degraded_performance' }]
        : [],
    },
  };
}

function feedWith(provider: FeedProvider | null): StatusFeed | null {
  if (!provider) return null;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return {
    schema_version: 1,
    checked_at: now,
    scheduled_for: now,
    run: { trigger: 'schedule', late: false, late_seconds: 0, missed_count: 0, missed_slots: [] },
    providers: { anthropic: provider },
  };
}

interface Args {
  overall: OverallStatus | 'no feed';
  incident: boolean;
  withLabel: boolean;
}

function Demo({ overall, incident, withLabel }: Args) {
  useEffect(() => {
    const feed = overall === 'no feed' ? null : feedWith(claude(overall, incident));
    useStatus.setState({
      feed,
      fetchedAt: feed ? Date.now() - 4 * 60_000 : null,
      source: feed ? 'network' : 'none',
    });
  }, [overall, incident]);
  return (
    <div className="flex min-h-[260px] items-start">
      <StatusDot provider="claude" withLabel={withLabel} />
    </div>
  );
}

const meta = {
  title: 'Status/StatusDot',
  component: Demo,
  args: { overall: 'operational', incident: false, withLabel: true },
  argTypes: {
    overall: {
      control: 'select',
      options: [
        'operational',
        'degraded',
        'partial_outage',
        'major_outage',
        'maintenance',
        'unknown',
        'no feed',
      ],
    },
  },
} satisfies Meta<typeof Demo>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Operational: Story = {};
export const DegradedWithIncident: Story = { args: { overall: 'degraded', incident: true } };
export const MajorOutage: Story = { args: { overall: 'major_outage', incident: true } };
export const Maintenance: Story = { args: { overall: 'maintenance' } };
export const NoFeedYet: Story = { args: { overall: 'no feed' } };
export const DotOnly: Story = { args: { withLabel: false, overall: 'degraded' } };
