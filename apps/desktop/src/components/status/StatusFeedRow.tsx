import { STATUS_HISTORY_URL } from '@command-center/protocol';
import { ExternalLink, RefreshCw } from 'lucide-react';
import { openExternal } from '../../lib/external';
import { ago } from '../../lib/status-feed';
import { useStatus } from '../../stores/status';
import { Button } from '../ui/button';
import { Row } from '../settings/parts';

/** Settings > AI agents: how fresh the status feed is, a refresh, and a link to its history. */
export function StatusFeedRow() {
  const fetchedAt = useStatus((s) => s.fetchedAt);
  const source = useStatus((s) => s.source);
  const error = useStatus((s) => s.error);
  const refreshing = useStatus((s) => s.refreshing);
  const refresh = useStatus((s) => s.refresh);

  const hint =
    fetchedAt === null
      ? error
        ? `No status yet: ${error}`
        : 'Waiting for the first status check.'
      : source === 'cache'
        ? `Offline: showing the copy from ${ago(fetchedAt)}.${error ? ' Refreshing failed.' : ''}`
        : `Updated ${ago(fetchedAt)}; refreshed every 30 minutes.`;

  return (
    <Row label="Provider status" hint={hint}>
      <span className="flex items-center gap-2">
        <Button size="sm" onClick={() => void refresh()} disabled={refreshing}>
          <RefreshCw
            size={12}
            className={refreshing ? 'animate-spin' : undefined}
            aria-hidden="true"
          />
          Refresh
        </Button>
        <Button size="sm" onClick={() => void openExternal(STATUS_HISTORY_URL)}>
          <ExternalLink size={12} aria-hidden="true" />
          View status history
        </Button>
      </span>
    </Row>
  );
}
