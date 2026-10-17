import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { DEFAULT_SETTINGS, type ConversationSettings } from '../lib/types';
import { usePrefs } from './prefs';

export const CODE_FONT_SIZES = [11, 12, 12.5, 13, 14, 15] as const;
export const DEFAULT_CODE_FONT_SIZE = 12.5;

interface SettingsState {
  /** Code blocks and diffs, in px. */
  codeFontSize: number;
  /** Model alias for new chats; null = the runtime's default. */
  defaultModel: string | null;
  /** Instructions every new chat starts with (editable per chat). */
  defaultSystemPrompt: string;

  setCodeFontSize: (size: number) => void;
  setDefaultModel: (model: string | null) => void;
  setDefaultSystemPrompt: (text: string) => void;
  reset: () => void;
}

const DEFAULTS = {
  codeFontSize: DEFAULT_CODE_FONT_SIZE,
  defaultModel: null,
  defaultSystemPrompt: '',
} as const;

/**
 * Preferences that belong to chats rather than to the app (interface size, theme and the rest
 * live in `stores/prefs.ts`); persisted so the window reopens as you left it.
 */
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULTS,
      setCodeFontSize: (codeFontSize) => set({ codeFontSize }),
      setDefaultModel: (defaultModel) => set({ defaultModel }),
      setDefaultSystemPrompt: (defaultSystemPrompt) => set({ defaultSystemPrompt }),
      reset: () => set({ ...DEFAULTS }),
    }),
    { name: 'command-center-settings' },
  ),
);

/**
 * What a brand-new chat starts with: built-in defaults plus the user's default provider, chosen
 * model and system prompt. The saved default model is a Claude alias, so it only applies to
 * Claude chats.
 */
export function freshDraft(): ConversationSettings {
  const { defaultModel, defaultSystemPrompt } = useSettings.getState();
  const provider = usePrefs.getState().prefs.providers.default;
  const systemPrompt = defaultSystemPrompt.trim() === '' ? null : defaultSystemPrompt;
  return {
    ...DEFAULT_SETTINGS,
    provider,
    model: provider === 'claude' ? defaultModel : null,
    systemPrompt,
  };
}

/** Pushes the display preferences onto the document (zoom for the interface, a CSS variable for code). */
export function applyDisplaySettings(uiScale: number, codeFontSize: number): void {
  const root = document.documentElement;
  root.style.setProperty('zoom', uiScale === 100 ? '' : String(uiScale / 100));
  root.style.setProperty('--code-font-size', `${codeFontSize}px`);
}
