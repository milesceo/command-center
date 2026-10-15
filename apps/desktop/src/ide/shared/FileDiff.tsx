import { useMemo } from 'react';
import { DiffView } from '../../components/code/DiffView';
import { diffFromTexts } from '../../lib/diff';
import { useUiStore } from '../../stores/ui';

interface Props {
  before: string;
  after: string;
  beforeName: string;
  afterName: string;
}

/** Side-by-side (or inline) diff of two texts. Default export so it can be lazy-loaded with the diff library. */
export default function FileDiff({ before, after, beforeName, afterName }: Props) {
  const mode = useUiStore((s) => s.diffMode);
  const wrap = useUiStore((s) => s.wrapCode);
  const files = useMemo(
    () => diffFromTexts(before, after, { oldName: beforeName, newName: afterName }),
    [before, after, beforeName, afterName],
  );
  return (
    <div className="h-full overflow-auto bg-bg">
      <DiffView files={files} mode={mode} wrap={wrap} />
    </div>
  );
}
