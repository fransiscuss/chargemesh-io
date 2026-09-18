/**
 * F14 placeholder worker process (same image as the gateway).
 *
 * Data sinks (Snowflake, webhook) and retention land here in F14.
 * Until then the process stays alive, handles SIGTERM/SIGINT so Fly
 * can stop it cleanly, and does no sink work.
 */
export type WorkerDeps = {
  log?: (message: string) => void;
  heartbeatMs?: number;
};

export function startWorker(deps: WorkerDeps = {}): { stop: () => void } {
  const log = deps.log ?? ((message: string) => console.info(message));
  const heartbeatMs = deps.heartbeatMs ?? 60_000;
  log('chargemesh worker started (sinks land in F14)');
  let stopping = false;
  const heartbeat = setInterval(() => {}, heartbeatMs);
  const stop = () => {
    if (stopping) return;
    stopping = true;
    clearInterval(heartbeat);
    log('chargemesh worker stopped');
  };
  process.once('SIGTERM', stop);
  process.once('SIGINT', stop);
  return { stop };
}

if (import.meta.main) {
  startWorker();
}
