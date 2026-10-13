import { useMemo } from 'react';
import { diffFromTexts, parseUnifiedDiff } from '../../lib/diff';
import type { DiffSource } from '../../stores/preview';
import { useUiStore } from '../../stores/ui';
import { DiffView } from '../code/DiffView';

/** Diff tab body. Default export so the panel can lazy-load it together with the diff library. */
export default function DiffTab({ diff }: { diff: DiffSource }) {
  const mode = useUiStore((s) => s.diffMode);
  const wrap = useUiStore((s) => s.wrapCode);
  const files = useMemo(
    () =>
      diff.type === 'patch'
        ? parseUnifiedDiff(diff.patch)
        : diffFromTexts(diff.before, diff.after, {
            oldName: diff.beforeName,
            newName: diff.afterName,
          }),
    [diff],
  );
  return (
    <div className="min-h-0 flex-1 overflow-auto bg-bg">
      <DiffView files={files} mode={mode} wrap={wrap} />
    </div>
  );
}
