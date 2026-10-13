import { useToastStore } from '../../stores/toast';

export function Toaster() {
  const toasts = useToastStore((s) => s.toasts);
  return (
    <div
      className="pointer-events-none fixed bottom-16 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2"
      role="status"
      aria-live="polite"
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          className="rounded-control border border-border-strong bg-elevated px-3 py-1.5 text-xs shadow-lg"
        >
          {t.message}
        </div>
      ))}
    </div>
  );
}
