import { isMacPlatform } from './shortcuts';

/**
 * Wording that names an operating-system feature. Windows and Linux keep the original text; macOS
 * gets its own names (Keychain, log in, menu bar), so a Mac user never reads Windows instructions.
 */
export const platformCopy = {
  /** Where API keys are stored. */
  credentialStore: (): string =>
    isMacPlatform() ? 'macOS Keychain' : 'Windows Credential Manager',
  /** The start-at-login switch. */
  startAtLogin: (): string =>
    isMacPlatform()
      ? 'Launch Command Center when you log in'
      : 'Launch Command Center when Windows starts',
  /** Where the app keeps running when its window is closed. */
  tray: (): string => (isMacPlatform() ? 'menu bar' : 'tray'),
  /** The operating system whose settings "System" follows. */
  os: (): string => (isMacPlatform() ? 'macOS' : 'Windows'),
};
