import { isTauri } from './tauri';

/**
 * Saves text to a file the user chooses. In the desktop app this is the native
 * save dialog; the dialog also grants the fs plugin write access to exactly
 * that path. In a browser it falls back to a download.
 * Resolves true when a file was written, false when the user cancelled.
 */
export async function saveTextFile(suggestedName: string, text: string): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import('@tauri-apps/plugin-dialog');
    const path = await save({ defaultPath: suggestedName });
    if (!path) return false;
    const { writeTextFile } = await import('@tauri-apps/plugin-fs');
    await writeTextFile(path, text);
    return true;
  }
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = suggestedName;
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return true;
}
