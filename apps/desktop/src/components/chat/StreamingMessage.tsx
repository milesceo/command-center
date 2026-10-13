import { Check, TriangleAlert, Wrench, X } from 'lucide-react';
import { describeUsageWarning } from '../../lib/errors';
import type { StreamState } from '../../stores/chat';
import { Markdown } from './Markdown';

/** The reply that is still arriving: markdown so far, tool activity and any usage warning. */
export function StreamingMessage({ stream }: { stream: StreamState }) {
  const warning = stream.rateLimit?.status === 'allowed_warning' ? stream.rateLimit : null;
  return (
    <div className="flex flex-col gap-2" data-role="assistant" data-streaming="true">
      {stream.tools.length > 0 && (
        <ul className="flex flex-col gap-1">
          {stream.tools.map((tool) => (
            <li key={tool.toolUseId} className="flex items-center gap-2 text-xs text-fg-muted">
              {tool.status === 'done' ? (
                <Check size={12} className="text-success" />
              ) : tool.status === 'error' ? (
                <X size={12} className="text-danger" />
              ) : (
                <Wrench size={12} />
              )}
              <span className="font-mono">{tool.name}</span>
              <span className="truncate font-mono text-fg-subtle">{tool.summary}</span>
            </li>
          ))}
        </ul>
      )}
      {stream.text ? <Markdown text={stream.text} /> : null}
      <span className="caret" aria-label="Claude is typing" role="status" />
      {warning && (
        <p className="flex items-center gap-1.5 text-xs text-warning">
          <TriangleAlert size={12} />
          {describeUsageWarning(warning)}
        </p>
      )}
    </div>
  );
}
