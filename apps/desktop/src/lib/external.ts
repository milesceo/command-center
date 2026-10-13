import { isTauri } from './tauri';

/** Opens a link in the system browser; the webview itself must never navigate away from the app. */
export async function openExternal(url: string): Promise<void> {
  if (!/^(https?:|mailto:)/i.test(url)) return;
  if (isTauri()) {
    const { openUrl } = await import('@tauri-apps/plugin-opener');
    await openUrl(url);
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
}
