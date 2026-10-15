import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { cn } from '../lib/cn';

interface Props {
  orientation: 'vertical' | 'horizontal';
  label: string;
  /** Called with the pointer position (clientX or clientY) while dragging. */
  onDrag: (position: number) => void;
  className?: string;
}

/** A thin drag handle between two panes. Keyboard users resize with the arrow keys via `onNudge`-free panes (not needed here). */
export function ResizeHandle({ orientation, label, onDrag, className }: Props) {
  const dragging = useRef(false);
  const vertical = orientation === 'vertical';
  return (
    <div
      role="separator"
      aria-orientation={orientation}
      aria-label={label}
      className={cn(
        'shrink-0 rounded-full transition-colors hover:bg-accent/40',
        vertical ? 'w-1 cursor-col-resize' : 'h-1 cursor-row-resize',
        className,
      )}
      onPointerDown={(e: ReactPointerEvent) => {
        dragging.current = true;
        e.currentTarget.setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e: ReactPointerEvent) => {
        if (dragging.current) onDrag(vertical ? e.clientX : e.clientY);
      }}
      onPointerUp={(e: ReactPointerEvent) => {
        dragging.current = false;
        e.currentTarget.releasePointerCapture(e.pointerId);
      }}
    />
  );
}
