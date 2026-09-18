import { createServer } from 'node:http';
import type { Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import WebSocket, { WebSocketServer } from 'ws';
import { parseFrame } from '@chargemesh/ocpp';
import type { Call, OcppVersion, Payload, ParseResult } from '@chargemesh/ocpp';
import { RpcPeer } from './rpcPeer.js';
import type { CallHandler, Response } from './rpcPeer.js';

export type CapturedFrame = {
  identity: string;
  direction: 'in' | 'out';
  raw: string;
  parsed: ParseResult;
  ts: number;
};
export type MockCsmsOptions = {
  port?: number;
  host?: string;
  now?: () => number;
  idGenerator?: () => string;
  timeoutMs?: number;
  responses?: Record<string, Payload | CallHandler>;
};

export class MockCsms {
  readonly frames: CapturedFrame[] = [];
  readonly handshakes = new Map<string, { authorization: string | undefined; protocol: string }>();
  private readonly peers = new Map<string, RpcPeer>();
  private readonly rejected = new Set<string>();
  private readonly delays = new Map<string, number>();
  private readonly responses = new Map<string, Payload | CallHandler>();
  private readonly server: Server;
  private readonly wss = new WebSocketServer({ noServer: true });
  private constructor(private readonly options: MockCsmsOptions) {
    for (const [action, response] of Object.entries(options.responses ?? {}))
      this.responses.set(action, response);
    this.server = createServer((_req, res) => {
      res.writeHead(404);
      res.end();
    });
    this.server.on('upgrade', (request, socket, head) => {
      let identity: string;
      try {
        identity = decodeURIComponent(
          new URL(request.url ?? '/', 'http://localhost').pathname.split('/').pop() ?? '',
        );
      } catch {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        return;
      }
      if (!identity) {
        socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
        return;
      }
      if (this.rejected.has(identity)) {
        socket.end('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');
        return;
      }
      this.wss.handleUpgrade(request, socket, head, (ws) => {
        const version: OcppVersion = ws.protocol === 'ocpp2.0.1' ? '2.0.1' : '1.6';
        const abort = new AbortController();
        ws.once('close', () => abort.abort());
        const peer = new RpcPeer(ws, {
          version,
          ...(options.idGenerator ? { idGenerator: options.idGenerator } : {}),
          ...(options.timeoutMs === undefined ? {} : { timeoutMs: options.timeoutMs }),
          onFrame: (direction, raw) =>
            this.frames.push({ identity, direction, raw, parsed: parseFrame(raw), ts: this.now() }),
          handler: async (call) => {
            const ms = this.delays.get(call.action) ?? 0;
            if (ms > 0) await delay(ms, undefined, { signal: abort.signal });
            const response = this.responses.get(call.action);
            if (typeof response === 'function') return response(call);
            return response ?? this.defaultResponse(call, version);
          },
        });
        this.peers.get(identity)?.socket.terminate();
        this.peers.set(identity, peer);
        this.handshakes.set(identity, {
          authorization: request.headers.authorization,
          protocol: ws.protocol,
        });
        ws.once('close', () => {
          if (this.peers.get(identity) === peer) this.peers.delete(identity);
        });
      });
    });
  }
  private now(): number {
    return (this.options.now ?? Date.now)();
  }
  private defaultResponse(call: Call, version: OcppVersion): Payload {
    switch (call.action) {
      case 'BootNotification':
        return {
          status: 'Accepted',
          currentTime: new Date(this.now()).toISOString(),
          interval: 60,
        };
      case 'Heartbeat':
        return { currentTime: new Date(this.now()).toISOString() };
      case 'Authorize':
        return version === '1.6'
          ? { idTagInfo: { status: 'Accepted' } }
          : { idTokenInfo: { status: 'Accepted' } };
      case 'StartTransaction':
        return { transactionId: 42, idTagInfo: { status: 'Accepted' } };
      case 'StopTransaction':
        return { idTagInfo: { status: 'Accepted' } };
      case 'StatusNotification':
      case 'MeterValues':
      case 'TransactionEvent':
        return {};
      default:
        return { status: 'Accepted' };
    }
  }
  static async start(options: MockCsmsOptions = {}): Promise<MockCsms> {
    const mock = new MockCsms(options);
    await new Promise<void>((resolve, reject) => {
      mock.server.once('error', reject);
      mock.server.listen(options.port ?? 0, options.host ?? '127.0.0.1', () => {
        mock.server.off('error', reject);
        resolve();
      });
    });
    return mock;
  }
  get url(): string {
    const address = this.server.address() as AddressInfo;
    return `ws://${address.family === 'IPv6' ? `[${address.address}]` : address.address}:${address.port}`;
  }
  setResponse(action: string, response: Payload | CallHandler): void {
    this.responses.set(action, response);
  }
  setDelay(action: string, ms: number): void {
    this.delays.set(action, ms);
  }
  rejectAuth(identity: string): void {
    this.rejected.add(identity);
  }
  dropConnection(identity: string): void {
    this.peers.get(identity)?.socket.terminate();
  }
  sendCall(identity: string, action: string, payload: Payload): Promise<Response> {
    const peer = this.peers.get(identity);
    return peer
      ? peer.call(action, payload)
      : Promise.reject(new Error('Charger is not connected'));
  }
  async close(): Promise<void> {
    for (const ws of this.wss.clients) if (ws.readyState !== WebSocket.CLOSED) ws.terminate();
    await new Promise<void>((resolve) => this.wss.close(() => resolve()));
    await new Promise<void>((resolve, reject) =>
      this.server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}
