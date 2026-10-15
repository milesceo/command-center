import { create } from 'zustand';

interface VisibilityState {
  /** False while the window is hidden to the tray (the OS tells us; `document.hidden` may not). */
  windowVisible: boolean;
  setWindowVisible: (visible: boolean) => void;
}

export const useVisibility = create<VisibilityState>()((set) => ({
  windowVisible: true,
  setWindowVisible: (windowVisible) => set({ windowVisible }),
}));

/** True when animations should be paused: hidden to the tray, minimized or a background tab. */
export const isPaused = (windowVisible: boolean, documentHidden: boolean): boolean =>
  !windowVisible || documentHidden;
