import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, type ConversationSettings } from '../lib/types';

/** Interface zoom steps, in percent. */
export const UI_SCALES = [90, 100, 110, 125] as const;
export const CODE_FONT_SIZES = [11, 12, 12.5, 13, 14, 15] as const;
export const DEFAULT_UI_SCALE = 100;
export const DEFAULT_CODE_FONT_SIZE = 12.5;

interface SettingsState {
  /** Whole-interface zoom (percent). */
  uiScale: number;
  /** Code blocks and diffs, in px. */
  codeFontSize: number;
  /** Model alias for new chats; null = the runtime's default. */
  defaultModel: string | null;
  /** Instructions every new chat starts with (editable per chat). */
  defaultSystemPrompt: string;

  setUiScale: (scale: number) => void;
  setCodeFontSize: (size: number) => void;
  setDefaultModel: (model: string | null) => void;
  setDefaultSystemPrompt: (text: string) => void;
  reset: () => void;
}

const DEFAULTS = {
  uiScale: DEFAULT_UI_SCALE,
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  defaultModel: null,
  defaultSystemPrompt: '',
} as const;

/** Preferences that are not part of any conversation; persisted so the window reopens as you left it. */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setUiScale: (uiScale) => set({ uiScale }),
      setCodeFontSize: (codeFontSize) => set({ codeFontSize }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: 'programish-settings' },
  ),
);

/** What a brand-new chat starts with: built-in defaults plus the user's chosen model and system prompt. */
export function freshDraft(): ConversationSettings {
  const { defaultModel, defaultSystemPrompt } = useSettings.getState();
  const systemPrompt = defaultSystemPrompt.trim() === '' ? null : defaultSystemPrompt;
  return { ...DEFAULT_SETTINGS, model: defaultModel, systemPrompt };
}

/** Pushes the display preferences onto the document (zoom for the interface, a CSS variable for code). */
export function applyDisplaySettings(uiScale: number, codeFontSize: number): void {
  const root = document.documentElement;
  root.style.setProperty('zoom', uiScale === 100 ? '' : String(uiScale / 100));
  root.style.setProperty('--code-font-size', `${codeFontSize}px`);
}
