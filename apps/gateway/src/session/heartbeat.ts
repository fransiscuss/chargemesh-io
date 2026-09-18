export interface HeartbeatLeg {
  ping(): void;
  terminate(): void;
  on(event: 'pong', listener: () => void): unknown;
  off(event: 'pong', listener: () => void): unknown;
}
export function startHeartbeat(leg: HeartbeatLeg, intervalMs = 30_000): () => void {
  let missed = 0;
  let awaiting = false;
  const pong = () => {
    missed = 0;
    awaiting = false;
  };
  leg.on('pong', pong);
  const timer = setInterval(() => {
    if (awaiting) missed++;
    if (missed >= 2) {
      clearInterval(timer);
      leg.off('pong', pong);
      leg.terminate();
      return;
    }
    awaiting = true;
    leg.ping();
  }, intervalMs);
  return () => {
    clearInterval(timer);
    leg.off('pong', pong);
  };
}
