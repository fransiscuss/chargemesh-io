import Fastify from 'fastify';
import WebSocket, { WebSocketServer } from 'ws';
import type { IncomingMessage } from 'node:http';
import type { Duplex } from 'node:stream';
import type { AddressInfo } from 'node:net';
import { ulid } from 'ulid';
import { negotiateSubprotocol } from '@chargemesh/ocpp';
import type { ConfigStore } from './config/store.js';
import { Pipeline } from './pipeline/pipeline.js';
import type { ConnectionTracker } from './recorder/connections.js';
import { parseIdentity } from './session/identity.js';
import { authenticateGateway } from './session/auth.js';
import { openPrimary, UpstreamError } from './session/upstream.js';
import { ChargerSession } from './session/chargerSession.js';
import { shutdown } from './shutdown.js';

export type GatewayOptions = {
  store: ConfigStore;
  allowInsecureWs: boolean;
  pipeline?: Pipeline;
  now?: () => number;
  idGenerator?: () => string;
  upstreamTimeoutMs?: number;
  trustFlyProxy?: boolean;
  logLevel?: string;
  /** F4 traffic recorder drain hook; flushed on shutdown before the pipeline. */
  recorder?: { flush: () => Promise<void> };
  /** F4 connection tracker; open/close rows are best-effort and never fail upgrades. */
  connections?: ConnectionTracker;
};
export function createGateway(options: GatewayOptions) {
  const app = Fastify({ logger: { level: options.logLevel ?? 'info' } });
  const pipeline = options.pipeline ?? new Pipeline([], [], app.log);
  const sessions = new Map<string, ChargerSession>();
  const upgrades = new Set<AbortController>();
  const protocols = new WeakMap<IncomingMessage, string>();
  const wss = new WebSocketServer({
    noServer: true,
    handleProtocols: (_offered, request) => protocols.get(request) ?? false,
  });
  let stopping = false;
  let closing: Promise<void> | undefined;
  app.get('/healthz', async () => ({ ok: !stopping, chargersConnected: sessions.size }));

  const reject = (socket: Duplex, status: number) => {
    if (socket.destroyed) return;
    const reason = (
      {
        400: 'Bad Request',
        401: 'Unauthorized',
        403: 'Forbidden',
        404: 'Not Found',
        502: 'Bad Gateway',
        503: 'Service Unavailable',
      } as Record<number, string>
    )[status];
    socket.end(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`);
  };
  const upgrade = async (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const abort = new AbortController();
    upgrades.add(abort);
    const disconnected = () => abort.abort();
    socket.once('close', disconnected);
    socket.on('error', () => socket.destroy());
    let primary: Awaited<ReturnType<typeof openPrimary>> | undefined;
    try {
      if (stopping) {
        reject(socket, 503);
        return;
      }
      // Fly terminates TLS and supplies this header. Direct local WS requires explicit opt-in.
      const secure =
        ('encrypted' in request.socket && request.socket.encrypted) ||
        (options.trustFlyProxy === true && request.headers['fly-forwarded-proto'] === 'https');
      if (!secure && !options.allowInsecureWs) {
        reject(socket, 403);
        return;
      }
      let identity: string;
      try {
        identity = parseIdentity(request.url ?? '');
      } catch {
        reject(socket, 400);
        return;
      }
      const config = await options.store.get(identity);
      if (!config) {
        reject(socket, 404);
        return;
      }
      if (!config.enabled) {
        reject(socket, 403);
        return;
      }
      if (!config.primary) {
        reject(socket, 502);
        return;
      }
      const offered = (request.headers['sec-websocket-protocol'] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);
      const protocol = negotiateSubprotocol(offered, config.version);
      if (!protocol) {
        reject(socket, 400);
        return;
      }
      const authorization = request.headers.authorization;
      if (
        config.authMode === 'gateway' &&
        !(await authenticateGateway(authorization, config.passwordHash))
      ) {
        reject(socket, 401);
        return;
      }
      const upstreamIdentity = config.primary.identityOverride ?? config.identity;
      const url = new URL(config.primary.url);
      if (!['ws:', 'wss:'].includes(url.protocol)) throw new UpstreamError(502);
      url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(upstreamIdentity)}`;
      const upstreamAuth =
        config.authMode === 'passthrough'
          ? authorization
          : config.primary.password === null
            ? undefined
            : `Basic ${Buffer.from(`${upstreamIdentity}:${config.primary.password}`).toString('base64')}`;
      primary = await openPrimary(
        url.toString(),
        protocol,
        upstreamAuth,
        abort.signal,
        options.upstreamTimeoutMs,
      );
      if (stopping || socket.destroyed || primary.socket.readyState !== WebSocket.OPEN) {
        primary.socket.terminate();
        reject(socket, 502);
        return;
      }
      protocols.set(request, protocol);
      const link = primary;
      let accepted = false;
      wss.handleUpgrade(request, socket, head, (charger) => {
        accepted = true;
        const id = (options.idGenerator ?? ulid)();
        const session = new ChargerSession(
          id,
          config,
          charger,
          link,
          pipeline,
          () => sessions.delete(id),
          options.now,
        );
        sessions.set(id, session);
        const tracker = options.connections;
        if (tracker) {
          const upstreamConnectionId = (options.idGenerator ?? ulid)();
          const remoteIp = request.socket.remoteAddress ?? null;
          void tracker
            .opened({
              id,
              chargerId: config.id,
              kind: 'charger',
              remoteIp,
              subprotocol: protocol,
            })
            .catch((error: unknown) => app.log.error(error, 'Connection open not recorded'));
          void tracker
            .opened({
              id: upstreamConnectionId,
              chargerId: config.id,
              kind: 'upstream',
              upstreamId: config.primary!.id,
              remoteIp: null,
              subprotocol: protocol,
            })
            .catch((error: unknown) => app.log.error(error, 'Connection open not recorded'));
          charger.once('close', (code: number, reason: Buffer) => {
            void tracker
              .closed(id, config.id, 'charger', {
                closeCode: code,
                closeReason: reason.toString(),
              })
              .catch((error: unknown) => app.log.error(error, 'Connection close not recorded'));
          });
          link.socket.once('close', (code: number, reason: Buffer) => {
            void tracker
              .closed(upstreamConnectionId, config.id, 'upstream', {
                closeCode: code,
                closeReason: reason.toString(),
              })
              .catch((error: unknown) => app.log.error(error, 'Connection close not recorded'));
          });
        }
      });
      // If ws rejects a malformed handshake before accepting, do not leak the primary.
      if (!accepted) {
        primary.socket.terminate();
      }
    } catch (error) {
      primary?.socket.terminate();
      reject(socket, error instanceof UpstreamError ? error.status : 502);
    } finally {
      upgrades.delete(abort);
      socket.off('close', disconnected);
    }
  };
  app.server.on('upgrade', (request, socket, head) => {
    void upgrade(request, socket, head);
  });

  return {
    app,
    sessions,
    pipeline,
    async listen(port = 8080, host = '0.0.0.0') {
      await app.listen({ port, host });
      const address = app.server.address() as AddressInfo;
      return `ws://${host === '0.0.0.0' ? '127.0.0.1' : host}:${address.port}/ocpp`;
    },
    close(): Promise<void> {
      closing ??= shutdown({
        stopAccepting: () => {
          stopping = true;
          app.server.close();
          for (const abort of upgrades) abort.abort();
        },
        closeSessions: async (code) => {
          await Promise.all([...sessions.values()].map((session) => session.close(code)));
        },
        flush: async () => {
          // Drain the recorder queue first so pending record writes resolve,
          // then await the pipeline's async observers, then drain stragglers.
          await options.recorder?.flush();
          await pipeline.flush();
          await options.recorder?.flush();
        },
        exit: async () => {
          await new Promise<void>((resolve) => wss.close(() => resolve()));
          await app.close();
        },
      });
      return closing;
    },
  };
}
