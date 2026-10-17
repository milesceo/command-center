import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export const ASSISTANT_MIN = 340;
export const ASSISTANT_MAX = 720;
export const ASSISTANT_DEFAULT = 420;
export const BOTTOM_MIN = 140;
export const BOTTOM_MAX = 480;
export const BOTTOM_DEFAULT = 232;

const clamp = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, Math.round(value)));

interface IdeState {
  assistantOpen: boolean;
  assistantWidth: number;
  bottomOpen: boolean;
  bottomHeight: number;
  /** Project ids collapsed in the explorer. */
  collapsedProjects: Record<string, boolean>;
  /** Explorer sections collapsed by id. */
  collapsedSections: Record<string, boolean>;

  /** Transient: which file tab is active and which were closed, per conversation. */
  activeFile: Record<string, string | null>;
  closedFiles: Record<string, string[]>;

  toggleAssistant: () => void;
  setAssistantWidth: (width: number) => void;
  toggleBottom: () => void;
  setBottomHeight: (height: number) => void;
  toggleProject: (projectId: string) => void;
  toggleSection: (sectionId: string) => void;
  setActiveFile: (conversationId: string, fileKey: string | null) => void;
  closeFile: (conversationId: string, fileKey: string) => void;
}

/** Layout of the IDE shell; the panels reopen as you left them. */
export const useIdeStore = create<IdeState>()(
  persist(
    (set) => ({
      assistantOpen: true,
      assistantWidth: ASSISTANT_DEFAULT,
      bottomOpen: false,
      bottomHeight: BOTTOM_DEFAULT,
      collapsedProjects: {},
      collapsedSections: {},
      activeFile: {},
      closedFiles: {},

      toggleAssistant: () => set((s) => ({ assistantOpen: !s.assistantOpen })),
      setAssistantWidth: (width) =>
        set({ assistantWidth: clamp(width, ASSISTANT_MIN, ASSISTANT_MAX) }),
      toggleBottom: () => set((s) => ({ bottomOpen: !s.bottomOpen })),
      setBottomHeight: (height) => set({ bottomHeight: clamp(height, BOTTOM_MIN, BOTTOM_MAX) }),
      toggleProject: (projectId) =>
        set((s) => ({
          collapsedProjects: {
            ...s.collapsedProjects,
            [projectId]: !s.collapsedProjects[projectId],
          },
        })),
      toggleSection: (sectionId) =>
        set((s) => ({
          collapsedSections: {
            ...s.collapsedSections,
            [sectionId]: !s.collapsedSections[sectionId],
          },
        })),
      setActiveFile: (conversationId, fileKey) =>
        set((s) => ({
          activeFile: { ...s.activeFile, [conversationId]: fileKey },
          // Opening a file brings back a tab that was closed.
          closedFiles: {
            ...s.closedFiles,
            [conversationId]: (s.closedFiles[conversationId] ?? []).filter((k) => k !== fileKey),
          },
        })),
      closeFile: (conversationId, fileKey) =>
        set((s) => ({
          closedFiles: {
            ...s.closedFiles,
            [conversationId]: [...(s.closedFiles[conversationId] ?? []), fileKey],
          },
          activeFile: {
            ...s.activeFile,
            [conversationId]:
              s.activeFile[conversationId] === fileKey
                ? null
                : (s.activeFile[conversationId] ?? null),
          },
        })),
    }),
    {
      name: 'command-center-ide',
      partialize: ({
        assistantOpen,
        assistantWidth,
        bottomOpen,
        bottomHeight,
        collapsedProjects,
        collapsedSections,
      }) => ({
        assistantOpen,
        assistantWidth,
        bottomOpen,
        bottomHeight,
        collapsedProjects,
        collapsedSections,
      }),
    },
  ),
);
