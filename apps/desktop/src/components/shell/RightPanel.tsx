import { useUiStore } from '../../stores/ui';
import { PreviewPanel } from '../preview/PreviewPanel';

/** The collapsible right-hand panel reserved in phase 1; it now hosts previews and diffs. */
export function RightPanel() {
  const open = useUiStore((s) => s.rightPanelOpen);
  return open ? <PreviewPanel /> : null;
}
