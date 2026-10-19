// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { useIdeStore } from '../stores/ide';
import { useUiStore } from '../stores/ui';
import { enterPlanFullWidth, restorePlanFullWidth } from './plan-full-width';

beforeEach(() => {
  useUiStore.setState({
    layout: 'ide',
    sidebarOpen: true,
    planListOpen: true,
    rightPanelOpen: false,
    planFullWidth: null,
  });
  useIdeStore.setState({ assistantOpen: true });
});

const panels = () => ({
  list: useUiStore.getState().planListOpen,
  sidebar: useUiStore.getState().sidebarOpen,
  preview: useUiStore.getState().rightPanelOpen,
  assistant: useIdeStore.getState().assistantOpen,
});

describe('enterPlanFullWidth', () => {
  it('in the editor layout hides the list, sidebar and assistant but never touches the preview', () => {
    useUiStore.setState({ rightPanelOpen: true });
    enterPlanFullWidth();
    expect(useUiStore.getState().planFullWidth).toEqual({
      list: true,
      sidebar: true,
      assistant: true,
      preview: false,
    });
    expect(panels()).toEqual({ list: false, sidebar: false, preview: true, assistant: false });
  });

  it('in the classic layout hides the preview but never touches the assistant', () => {
    useUiStore.setState({ layout: 'classic', rightPanelOpen: true });
    enterPlanFullWidth();
    expect(useUiStore.getState().planFullWidth).toEqual({
      list: true,
      sidebar: true,
      assistant: false,
      preview: true,
    });
    expect(panels()).toEqual({ list: false, sidebar: false, preview: false, assistant: true });
  });

  it('does not record panels that were already closed', () => {
    useUiStore.setState({ planListOpen: false, sidebarOpen: false });
    useIdeStore.setState({ assistantOpen: false });
    enterPlanFullWidth();
    expect(useUiStore.getState().planFullWidth).toEqual({
      list: false,
      sidebar: false,
      assistant: false,
      preview: false,
    });
    restorePlanFullWidth();
    expect(panels()).toEqual({ list: false, sidebar: false, preview: false, assistant: false });
  });

  it('entering twice is a no-op: the second call does not overwrite the record or toggle back', () => {
    enterPlanFullWidth();
    const record = useUiStore.getState().planFullWidth;
    enterPlanFullWidth();
    expect(useUiStore.getState().planFullWidth).toBe(record);
    expect(panels()).toEqual({ list: false, sidebar: false, preview: false, assistant: false });
    restorePlanFullWidth();
    expect(panels()).toEqual({ list: true, sidebar: true, preview: false, assistant: true });
  });
});

describe('restorePlanFullWidth', () => {
  it('is a no-op when full width is off', () => {
    useUiStore.setState({ planListOpen: false, sidebarOpen: false });
    restorePlanFullWidth();
    expect(panels()).toEqual({ list: false, sidebar: false, preview: false, assistant: true });
    expect(useUiStore.getState().planFullWidth).toBeNull();
  });

  it('calling it twice does not toggle a panel closed again', () => {
    enterPlanFullWidth();
    restorePlanFullWidth();
    restorePlanFullWidth();
    expect(panels()).toEqual({ list: true, sidebar: true, preview: false, assistant: true });
  });

  it('leaves a toggled panel open when the owner reopened it while reading full width', () => {
    enterPlanFullWidth();
    useUiStore.getState().toggleSidebar();
    useIdeStore.getState().toggleAssistant();
    restorePlanFullWidth();
    expect(panels()).toEqual({ list: true, sidebar: true, preview: false, assistant: true });
  });
});
