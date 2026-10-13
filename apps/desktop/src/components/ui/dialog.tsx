import { useEffect, useRef, type ReactNode } from 'react';
import { useFocusTrap } from '../../lib/use-focus-trap';
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
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel, open);

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
        ref={panel}
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

interface ModalProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  /** Tailwind max-width class for the panel. */
  width?: string;
}

/** A plain modal panel: Escape and a click on the backdrop close it, and it names itself for screen readers. */
export function Modal({ title, onClose, children, width = 'max-w-lg' }: ModalProps) {
  const panel = useRef<HTMLDivElement>(null);
  useFocusTrap(panel);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`flex max-h-[85vh] w-full flex-col rounded-panel border border-border-strong bg-elevated shadow-xl ${width}`}
      >
        <h2 className="shrink-0 px-4 pt-4 text-sm font-semibold">{title}</h2>
        {children}
      </div>
    </div>
  );
}
