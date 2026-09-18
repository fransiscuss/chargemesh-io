import WebSocket from 'ws';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { subprotocols } from '@chargemesh/ocpp';
import type { OcppVersion, Payload } from '@chargemesh/ocpp';
import { RpcPeer } from './rpcPeer.js';
import type { CallHandler, PeerOptions, Response } from './rpcPeer.js';

export type SimChargerOptions = {
  url: string;
  id: string;
  version: OcppVersion;
  password?: string;
  timeoutMs?: number;
  idGenerator?: () => string;
  onFrame?: NonNullable<PeerOptions['onFrame']>;
};

export class SimCharger {
  private constructor(
    readonly socket: WebSocket,
    private readonly peer: RpcPeer,
  ) {}
  static async connect(options: SimChargerOptions): Promise<SimCharger> {
    const url = new URL(options.url);
    if (!['ws:', 'wss:'].includes(url.protocol)) throw new Error('Expected a ws:// or wss:// URL');
    url.pathname = `${url.pathname.replace(/\/$/, '')}/${encodeURIComponent(options.id)}`;
    const socket = new WebSocket(url, subprotocols[options.version], {
      handshakeTimeout: options.timeoutMs ?? 10_000,
      ...(options.password === undefined
        ? {}
        : {
            headers: {
              Authorization: `Basic ${Buffer.from(`${options.id}:${options.password}`).toString('base64')}`,
            },
          }),
    });
    const peer = new RpcPeer(socket, options);
    await new Promise<void>((resolve, reject) => {
      const cleanup = () => {
        socket.off('open', opened);
        socket.off('error', failed);
        socket.off('unexpected-response', unexpected);
      };
      const opened = () => {
        cleanup();
        resolve();
      };
      const failed = (error: Error) => {
        cleanup();
        reject(error);
      };
      const unexpected = (request: ClientRequest, response: IncomingMessage) => {
        cleanup();
        response.resume();
        request.destroy();
        socket.terminate();
        reject(new Error(`WebSocket upgrade failed: ${response.statusCode}`));
      };
      socket.once('open', opened);
      socket.once('error', failed);
      socket.once('unexpected-response', unexpected);
    });
    return new SimCharger(socket, peer);
  }
  call(action: string, payload: Payload): Promise<Response> {
    return this.peer.call(action, payload);
  }
  onCall(action: string, handler: CallHandler): void {
    this.peer.onCall(action, handler);
  }
  close(): Promise<void> {
    return this.peer.close();
  }
}
