import { cn } from '../../lib/cn';
import { useBridgeStore, type BridgeStatus as Status } from '../../stores/bridge';

/** Short: it sits in the classic sidebar footer beside three icon buttons. */
export const LABEL: Record<Status, string> = {
  idle: 'Bridge on standby',
  connecting: 'Connecting…',
  ready: 'Bridge ready',
  error: 'Bridge error',
  unavailable: 'Bridge offline (web preview)',
};

export const DOT: Record<Status, string> = {
  idle: 'bg-fg-subtle',
  connecting: 'bg-warning',
  ready: 'bg-success',
  error: 'bg-danger',
  unavailable: 'bg-fg-subtle',
};

/** Clicking re-runs the ping, which doubles as a quick wiring check. */
export function BridgeStatus() {
  const { status, lastPing, error, ping } = useBridgeStore();
  const detail =
    error ?? (lastPing ? `pong ${lastPing.latencyMs}ms · v${lastPing.bridgeVersion}` : null);

  return (
    <button
      type="button"
      onClick={() => void ping()}
      title={
        detail ?? (status === 'idle' ? 'Bridge on standby: starts on the next chat' : LABEL[status])
      }
      className="flex min-w-0 flex-1 items-center gap-2 rounded-control px-2 py-1 text-left text-xs text-fg-muted hover:bg-hover"
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', DOT[status])} />
      <span className="truncate">{detail && status === 'ready' ? detail : LABEL[status]}</span>
    </button>
  );
}
