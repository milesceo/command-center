import { useEffect, useRef, type ReactNode } from 'react';
import { Button } from './button';

interface ConfirmProps {
  open: boolean;
  title: string;
  children: ReactNode;
  confirmLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/** Minimal modal confirmation. Escape and backdrop click cancel; focus starts on Cancel (the safe choice). */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel,
  destructive,
  onConfirm,
  onCancel,
}: ConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    cancelRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onCancel();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onCancel]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onCancel()}
    >
      <div
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        className="w-full max-w-sm rounded-panel border border-border-strong bg-elevated p-4 shadow-xl"
      >
        <h2 id="confirm-title" className="text-sm font-semibold">
          {title}
        </h2>
        <div className="mt-1.5 text-fg-muted">{children}</div>
        <div className="mt-4 flex justify-end gap-2">
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>
            Cancel
          </Button>
          <Button
            variant="primary"
            className={destructive ? 'bg-danger text-white' : undefined}
            onClick={onConfirm}
          >
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
