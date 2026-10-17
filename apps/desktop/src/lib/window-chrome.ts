import { isMacPlatform } from './shortcuts';
import { isTauri } from './tauri';

/**
 * True in the desktop app on macOS, where the window keeps the native traffic lights (an
 * overlay title bar, see `tauri.macos.conf.json`) instead of the custom ones: the toolbars hide
 * `WindowControls` and leave room at the left for the system's buttons.
 */
export function usesNativeTitleBar(): boolean {
  return isTauri() && isMacPlatform();
}

/** Width kept free at the left of a toolbar for the macOS traffic lights. */
export const NATIVE_LIGHTS_INSET = 'pl-[76px]';
