import WebSocket from 'ws';
import type { ClientRequest, IncomingMessage } from 'node:http';

export class UpstreamError extends Error {
  constructor(readonly status: number) {
    super(`Primary connection failed (${status})`);
  }
}
export type PrimaryLink = { socket: WebSocket; takeBuffered: () => string[] };
export function openPrimary(
  url: string,
  protocol: string,
  authorization: string | undefined,
  signal: AbortSignal,
  timeoutMs = 10_000,
): Promise<PrimaryLink> {
  return new Promise((resolve, reject) => {
    let ws: WebSocket;
    try {
      ws = new WebSocket(url, protocol, {
        handshakeTimeout: timeoutMs,
        ...(authorization === undefined ? {} : { headers: { Authorization: authorization } }),
      });
    } catch {
      reject(new UpstreamError(502));
      return;
    }
    const buffered: string[] = [];
    const buffer = (raw: WebSocket.RawData) => buffered.push(raw.toString());
    ws.on('message', buffer);
    // Keep an error listener during the handover between upgrade and session setup.
    ws.on('error', () => undefined);
    const cleanup = () => {
      ws.off('open', opened);
      ws.off('error', failed);
      ws.off('unexpected-response', unexpected);
      signal.removeEventListener('abort', abort);
    };
    const failed = () => {
      cleanup();
      ws.terminate();
      reject(new UpstreamError(502));
    };
    const abort = () => failed();
    const unexpected = (request: ClientRequest, response: IncomingMessage) => {
      cleanup();
      response.resume();
      request.destroy();
      ws.terminate();
      reject(new UpstreamError(response.statusCode === 401 ? 401 : 502));
    };
    const opened = () => {
      cleanup();
      resolve({
        socket: ws,
        takeBuffered: () => {
          ws.off('message', buffer);
          return buffered.splice(0);
        },
      });
    };
    ws.once('open', opened);
    ws.once('error', failed);
    ws.once('unexpected-response', unexpected);
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) abort();
  });
}
