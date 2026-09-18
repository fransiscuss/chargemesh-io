import WebSocket from 'ws';
import type { RawData } from 'ws';
import type { ChargerConfig } from '../config/store.js';
import type { Pipeline } from '../pipeline/pipeline.js';
import { Router } from './router.js';
import { startHeartbeat } from './heartbeat.js';
import type { PrimaryLink } from './upstream.js';

export class ChargerSession {
  readonly router: Router;
  private readonly stopHeartbeats: Array<() => void>;
  private readonly sweepTimer: ReturnType<typeof setInterval>;
  constructor(
    readonly id: string,
    readonly config: ChargerConfig,
    readonly charger: WebSocket,
    readonly primary: PrimaryLink,
    pipeline: Pipeline,
    onClosed: () => void,
    now: () => number = Date.now,
  ) {
    this.router = new Router({
      chargerId: config.id,
      chargerIdentity: config.identity,
      connectionId: id,
      version: config.version,
      upstreamId: config.primary!.id,
      charger,
      primary: primary.socket,
      pipeline,
      now,
    });
    charger.on('message', (raw: RawData) => this.router.route('charger', raw.toString()));
    primary.socket.on('message', (raw: RawData) => this.router.route('upstream', raw.toString()));
    charger.on('error', () => charger.terminate());
    primary.socket.on('error', () => primary.socket.terminate());
    primary.socket.once('close', () => {
      if (charger.readyState === WebSocket.OPEN) void this.closeLeg(charger, 1011);
    });
    this.stopHeartbeats = [startHeartbeat(charger), startHeartbeat(primary.socket)];
    this.sweepTimer = setInterval(() => this.router.sweep(), 60_000);
    charger.once('close', () => {
      clearInterval(this.sweepTimer);
      for (const stop of this.stopHeartbeats) stop();
      if (primary.socket.readyState === WebSocket.OPEN) void this.closeLeg(primary.socket, 1000);
      onClosed();
    });
    for (const raw of primary.takeBuffered()) this.router.route('upstream', raw);
  }
  async close(code = 1001): Promise<void> {
    await Promise.all([
      this.closeLeg(this.charger, code),
      this.closeLeg(this.primary.socket, 1000),
    ]);
  }
  private async closeLeg(socket: WebSocket, code: number): Promise<void> {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => socket.terminate(), 1000);
      socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      socket.close(code);
    });
  }
}
