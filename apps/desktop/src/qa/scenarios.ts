import type { FeedProvider, StatusFeed } from '@command-center/protocol';
import { usePrefs } from '../stores/prefs';
import { useStatus } from '../stores/status';
import { useUiStore } from '../stores/ui';
import type { ScenarioId } from './checklist';

/**
 * One-click setup for a checklist item. Every scenario is safe: it navigates, flips a
 * preference that Settings also exposes, or simulates a state in memory. None sets a PIN, writes
 * a key, or erases data, and the simulated feed states are replaced by the next real refresh.
 */
export interface Scenario {
  label: string;
  /** Returns a short note shown next to the button ("Switched to Lightest; reload to see it"). */
  run: () => string | void;
}

function openSettings(sectionTitle: string): string {
  useUiStore.getState().setView('settings');
  // The view mounts asynchronously (it is a lazy chunk), so wait for the heading.
  let attempts = 0;
  const scroll = () => {
    const heading = document.getElementById(`settings-${sectionTitle}`);
    if (heading) heading.scrollIntoView({ block: 'start' });
    else if (attempts++ < 20) setTimeout(scroll, 100);
  };
  setTimeout(scroll, 50);
  return `Opened Settings > ${sectionTitle}.`;
}

const SIMULATED_PROVIDER: FeedProvider = {
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
    overall: 'operational',
    summary: 'All Systems Operational',
    incidents: [],
    affected_components: [],
  },
};

function currentFeed(): StatusFeed {
  const existing = useStatus.getState().feed;
  if (existing) return existing;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  return {
    schema_version: 1,
    checked_at: now,
    scheduled_for: now,
    run: { trigger: 'local', late: false, late_seconds: 0, missed_count: 0, missed_slots: [] },
    providers: { anthropic: SIMULATED_PROVIDER },
  };
}

export const SCENARIOS: Record<ScenarioId, Scenario> = {
  'go-home': {
    label: 'Open Home',
    run: () => {
      useUiStore.getState().setView('landing');
      return 'Opened Home.';
    },
  },
  'restart-onboarding': {
    label: 'Restart onboarding',
    run: () => {
      usePrefs.getState().restartOnboarding();
      return 'Onboarding restarted; your current values are the starting point.';
    },
  },
  'open-settings-security': { label: 'Open Security', run: () => openSettings('Security') },
  'open-settings-agents': { label: 'Open AI agents', run: () => openSettings('AI agents') },
  'open-model-lab': {
    label: 'Open Model Lab',
    run: () => {
      useUiStore.getState().setView('models');
      return 'Opened the Model Lab.';
    },
  },
  'open-settings-system': { label: 'Open System', run: () => openSettings('System') },
  'open-settings-appearance': {
    label: 'Open Appearance',
    run: () => openSettings('Appearance'),
  },
  'tier-lightest': {
    label: 'Use the Lightest tier',
    run: () => {
      usePrefs.getState().setTier('lightest');
      return 'Tier set to Lightest. Reload to see the splash change.';
    },
  },
  'tier-balanced': {
    label: 'Use the Balanced tier',
    run: () => {
      usePrefs.getState().setTier('balanced');
      return 'Tier set to Balanced.';
    },
  },
  'tier-accelerated': {
    label: 'Use the Accelerated tier',
    run: () => {
      usePrefs.getState().setTier('accelerated');
      return 'Tier set to Accelerated. Reload to see the splash change.';
    },
  },
  'simulate-new-model': {
    label: 'Simulate a new Claude model',
    run: () => {
      const model = {
        id: 'claude-qa-preview-1',
        display_name: 'Claude QA Preview 1',
        created_at: null,
        first_seen: new Date().toISOString().slice(0, 10),
      };
      useStatus.setState((s) => ({
        notices: [
          ...s.notices.filter((n) => n.model.id !== model.id),
          { provider: 'claude', model },
        ],
        added: { ...s.added, claude: [...(s.added.claude ?? []), model] },
      }));
      return 'A notice appeared and the model was added to the Claude picker (until the app restarts).';
    },
  },
  'simulate-claude-degraded': {
    label: 'Simulate a degraded Claude',
    run: () => {
      const feed = currentFeed();
      const claude = Object.entries(feed.providers).find(([, p]) => p.geeked_provider === 'claude');
      const [key, base] = claude ?? ['anthropic', SIMULATED_PROVIDER];
      const next: StatusFeed = {
        ...feed,
        providers: {
          ...feed.providers,
          [key]: {
            ...base,
            status: {
              ...base.status,
              state: 'ok',
              overall: 'degraded',
              summary: 'Simulated: elevated error rates',
              incidents: [
                {
                  id: 'qa-simulated',
                  title: 'Simulated incident for testing',
                  status: 'investigating',
                  impact: 'minor',
                  url: null,
                  started_at: null,
                  updated_at: null,
                },
              ],
            },
          },
        },
      };
      useStatus.setState({ feed: next, fetchedAt: Date.now(), source: 'network' });
      return 'Claude shows as degraded until the next real refresh (up to 30 minutes, or press Refresh).';
    },
  },
  'reload-app': {
    label: 'Reload the app',
    run: () => {
      setTimeout(() => window.location.reload(), 150);
      return 'Reloading…';
    },
  },
};
