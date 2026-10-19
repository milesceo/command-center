// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Db } from '../../lib/db';
import { createTestDb } from '../../lib/sqlite-test-db';

const hoisted = vi.hoisted(() => ({ db: undefined as unknown as Db }));
vi.mock('../../lib/db', () => ({ getDb: () => Promise.resolve(hoisted.db) }));

import { useIdeStore } from '../../stores/ide';
import { usePlans } from '../../stores/plans';
import { useUiStore } from '../../stores/ui';
import { restorePlanFullWidth } from '../../lib/plan-full-width';
import { BusinessPlansView } from './BusinessPlansView';

beforeEach(async () => {
  hoisted.db = createTestDb();
  usePlans.setState({ plans: [], loaded: false, error: null, selectedId: null });
  useUiStore.setState({
    layout: 'ide',
    sidebarOpen: true,
    planListOpen: true,
    rightPanelOpen: false,
    planFullWidth: null,
  });
  useIdeStore.setState({ assistantOpen: true });
  await usePlans.getState().add({ title: 'Test plan', html: '<p>fixture</p>', source: null });
});
afterEach(cleanup);

describe('reading width', () => {
  it('hides and shows the plan list, and remembers the choice', async () => {
    render(<BusinessPlansView />);
    expect(await screen.findByRole('navigation', { name: 'Plans' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Hide the plan list' }));
    expect(screen.queryByRole('navigation', { name: 'Plans' })).toBeNull();
    expect(useUiStore.getState().planListOpen).toBe(false);
    const show = screen.getByRole('button', { name: 'Show the plan list' });
    expect(show.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(show);
    expect(screen.getByRole('navigation', { name: 'Plans' })).toBeTruthy();
  });

  it('full width hides the list, sidebar and assistant, then puts back only what it hid', async () => {
    useUiStore.setState({ sidebarOpen: false });
    render(<BusinessPlansView />);
    const button = await screen.findByRole('button', { name: 'Read full width' });
    fireEvent.click(button);
    expect(button.getAttribute('aria-pressed')).toBe('true');
    expect(useUiStore.getState().planListOpen).toBe(false);
    expect(useIdeStore.getState().assistantOpen).toBe(false);
    expect(useUiStore.getState().sidebarOpen).toBe(false);

    fireEvent.click(button);
    expect(useUiStore.getState().planListOpen).toBe(true);
    expect(useIdeStore.getState().assistantOpen).toBe(true);
    // The sidebar was already closed, so it stays closed.
    expect(useUiStore.getState().sidebarOpen).toBe(false);
  });

  it('leaving the view restores the layout, and the classic layout keeps the assistant alone', async () => {
    const { unmount } = render(<BusinessPlansView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read full width' }));
    expect(useUiStore.getState().sidebarOpen).toBe(false);
    unmount();
    expect(useUiStore.getState().sidebarOpen).toBe(true);
    expect(useIdeStore.getState().assistantOpen).toBe(true);

    useUiStore.setState({ layout: 'classic' });
    render(<BusinessPlansView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read full width' }));
    expect(useIdeStore.getState().assistantOpen).toBe(true);
  });

  it('the classic layout also closes the preview panel, and a panel reopened meanwhile is left alone', async () => {
    useUiStore.setState({ layout: 'classic', rightPanelOpen: true });
    render(<BusinessPlansView />);
    const button = await screen.findByRole('button', { name: 'Read full width' });
    fireEvent.click(button);
    expect(useUiStore.getState().rightPanelOpen).toBe(false);
    // The owner reopens the sidebar (Cmd+B) while reading full width.
    useUiStore.getState().toggleSidebar();
    fireEvent.click(button);
    expect(useUiStore.getState().rightPanelOpen).toBe(true);
    expect(useUiStore.getState().sidebarOpen).toBe(true);
  });

  it('a restart with full width on puts the panels back at launch', () => {
    // As saved on disk by a session that quit while reading full width.
    useUiStore.setState({
      planListOpen: false,
      sidebarOpen: false,
      planFullWidth: { list: true, sidebar: true, assistant: true, preview: false },
    });
    useIdeStore.setState({ assistantOpen: false });
    restorePlanFullWidth();
    expect(useUiStore.getState()).toMatchObject({
      planFullWidth: null,
      planListOpen: true,
      sidebarOpen: true,
    });
    expect(useIdeStore.getState().assistantOpen).toBe(true);
  });

  it('removing the last plan while reading full width restores the layout', async () => {
    render(<BusinessPlansView />);
    fireEvent.click(await screen.findByRole('button', { name: 'Read full width' }));
    expect(useIdeStore.getState().assistantOpen).toBe(false);
    await usePlans.getState().remove(usePlans.getState().plans[0]!.id);
    expect(await screen.findByText('No plans yet')).toBeTruthy();
    expect(useUiStore.getState().planFullWidth).toBeNull();
    expect(useIdeStore.getState().assistantOpen).toBe(true);
  });

  it('a StrictMode double mount restores nothing', async () => {
    render(
      <StrictMode>
        <BusinessPlansView />
      </StrictMode>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Read full width' }));
    expect(useUiStore.getState().planFullWidth).not.toBeNull();
    expect(useIdeStore.getState().assistantOpen).toBe(false);
  });

  it('both buttons are keyboard reachable, and aria-controls is dropped while the list is hidden', async () => {
    render(<BusinessPlansView />);
    const toggle = await screen.findByRole('button', { name: 'Hide the plan list' });
    const full = screen.getByRole('button', { name: 'Read full width' });
    for (const b of [toggle, full]) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.tabIndex).toBe(0);
      expect((b as HTMLButtonElement).disabled).toBe(false);
    }
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-controls')).toBe('plan-list');
    expect(document.getElementById('plan-list')).toBeTruthy();

    fireEvent.click(toggle);
    const show = screen.getByRole('button', { name: 'Show the plan list' });
    expect(show.hasAttribute('aria-controls')).toBe(false);
    expect(document.getElementById('plan-list')).toBeNull();
    // Focus stays on the same button (it is not remounted), so the keyboard user is not lost.
    expect(show).toBe(toggle);

    expect(full.getAttribute('aria-pressed')).toBe('false');
    fireEvent.click(full);
    expect(full.getAttribute('aria-pressed')).toBe('true');
    expect(
      screen.getByRole('button', { name: 'Show the plan list' }).hasAttribute('aria-controls'),
    ).toBe(false);
  });
});
