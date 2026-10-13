import type { BridgeError } from '@programish/protocol';
import { RefreshCw, TriangleAlert, X } from 'lucide-react';
import { describeError } from '../../lib/errors';
import { Button } from '../ui/button';

interface Props {
  error: BridgeError;
  onRetry?: () => void;
  onDismiss?: () => void;
}

/** Friendly failure message with an optional retry; technical text is tucked into "Details". */
export function ErrorNotice({ error, onRetry, onDismiss }: Props) {
  const friendly = describeError(error);
  return (
    <div
      role="alert"
      className="flex gap-3 rounded-panel border border-border-strong bg-elevated p-3"
    >
      <TriangleAlert size={16} className="mt-0.5 shrink-0 text-warning" />
      <div className="min-w-0 flex-1">
        <p className="font-medium">{friendly.title}</p>
        <p className="selectable mt-0.5 text-fg-muted">{friendly.body}</p>
        {friendly.details && (
          <details className="mt-1.5 text-xs text-fg-subtle">
            <summary className="cursor-pointer">Details</summary>
            <pre className="selectable mt-1 break-words whitespace-pre-wrap font-mono">
              {friendly.details}
            </pre>
          </details>
        )}
        {onRetry && (
          <Button size="sm" className="mt-2" onClick={onRetry}>
            <RefreshCw size={12} />
            Retry
          </Button>
        )}
      </div>
      {onDismiss && (
        <Button variant="ghost" size="icon" aria-label="Dismiss" onClick={onDismiss}>
          <X size={14} />
        </Button>
      )}
    </div>
  );
}
