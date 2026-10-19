import { useIdeStore } from '../stores/ide';
import { useUiStore, type PlanFullWidth } from '../stores/ui';

/**
 * Full-width reading of a business plan: hides the plan list, the sidebar or explorer, the
 * assistant (editor layout) and the preview panel (classic layout), and records what it hid in
 * the persisted UI store. Leaving puts back exactly those panels, and only if they are still
 * closed, so a panel the owner reopened meanwhile is left alone. Because the record is saved, a
 * restart with full width on is undone at launch (`restorePlanFullWidth` in App).
 */
export function enterPlanFullWidth(): void {
  const ui = useUiStore.getState();
  if (ui.planFullWidth) return;
  const ide = useIdeStore.getState();
  const hidden: PlanFullWidth = {
    list: ui.planListOpen,
    sidebar: ui.sidebarOpen,
    assistant: ui.layout === 'ide' && ide.assistantOpen,
    preview: ui.layout === 'classic' && ui.rightPanelOpen,
  };
  if (hidden.list) ui.setPlanListOpen(false);
  if (hidden.sidebar) ui.toggleSidebar();
  if (hidden.assistant) ide.toggleAssistant();
  if (hidden.preview) ui.setRightPanelOpen(false);
  useUiStore.setState({ planFullWidth: hidden });
}

/** Puts back what full width hid. Safe to call when it is off. */
export function restorePlanFullWidth(): void {
  const ui = useUiStore.getState();
  const hidden = ui.planFullWidth;
  if (!hidden) return;
  useUiStore.setState({ planFullWidth: null });
  if (hidden.list) ui.setPlanListOpen(true);
  if (hidden.sidebar && !useUiStore.getState().sidebarOpen) ui.toggleSidebar();
  if (hidden.preview && !useUiStore.getState().rightPanelOpen) ui.setRightPanelOpen(true);
  const ide = useIdeStore.getState();
  if (hidden.assistant && !ide.assistantOpen) ide.toggleAssistant();
}
