import type { ReactNode } from 'react';

/** A titled card in the settings view. */
export function Section({
  title,
  hint,
  children,
}: {
  title: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={`settings-${title}`}
      className="rounded-panel border border-border bg-surface p-4"
    >
      <h2 id={`settings-${title}`} className="text-sm font-semibold">
        {title}
      </h2>
      {hint && <p className="mt-0.5 text-[11px] text-fg-subtle">{hint}</p>}
      <div className="mt-3 flex flex-col gap-4">{children}</div>
    </section>
  );
}

/** A label (with optional hint) on the left and its control on the right. */
export function Row({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string | undefined;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="min-w-0">
        <p className="text-[13px]">{label}</p>
        {hint && <p className="text-[11px] text-fg-subtle">{hint}</p>}
      </div>
      {children}
    </div>
  );
}
