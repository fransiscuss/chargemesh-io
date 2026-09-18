import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';
import { callError, parseFrame, serializeFrame } from '@chargemesh/ocpp';
import type { Call, CallError, CallResult, Payload, OcppVersion } from '@chargemesh/ocpp';

export type Response = CallResult | CallError;
export type CallHandler = (call: Call) => Payload | null | Promise<Payload | null>;
export type PeerOptions = {
  version: OcppVersion;
  timeoutMs?: number;
  idGenerator?: () => string;
  onFrame?: (direction: 'in' | 'out', raw: string) => void;
  handler?: CallHandler;
};

export class RpcPeer {
  private readonly pending = new Map<
    string,
    {
      resolve: (response: Response) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private readonly handlers = new Map<string, CallHandler>();
  constructor(
    readonly socket: WebSocket,
    private readonly options: PeerOptions,
  ) {
    socket.on('message', (data) => this.receive(data.toString()));
    socket.on('close', () => this.rejectPending(new Error('Connection closed')));
    socket.on('error', () => this.rejectPending(new Error('WebSocket error')));
  }
  onCall(action: string, handler: CallHandler): void {
    this.handlers.set(action, handler);
  }

  call(action: string, payload: Payload): Promise<Response> {
    if (this.socket.readyState !== WebSocket.OPEN)
      return Promise.reject(new Error('Connection is not open'));
    const id = (this.options.idGenerator ?? randomUUID)();
    if (this.pending.has(id)) return Promise.reject(new Error('Duplicate pending call ID'));
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`Call timed out: ${action}`));
      }, this.options.timeoutMs ?? 10_000);
      this.pending.set(id, { resolve, reject, timer });
      try {
        this.send({ t: 2, id, action, payload });
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }
  private send(frame: Call | Response): void {
    const raw = serializeFrame(frame);
    this.socket.send(raw);
    this.options.onFrame?.('out', raw);
  }
  private receive(raw: string): void {
    this.options.onFrame?.('in', raw);
    const parsed = parseFrame(raw);
    if (!parsed.ok) return;
    const frame = parsed.frame;
    if (frame.t !== 2) {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      clearTimeout(pending.timer);
      this.pending.delete(frame.id);
      pending.resolve(frame);
      return;
    }
    void this.answer(frame);
  }
  private async answer(call: Call): Promise<void> {
    let response: Response;
    try {
      const handler = this.handlers.get(call.action) ?? this.options.handler;
      const payload = handler ? await handler(call) : { status: 'Accepted' };
      if (payload === null) return;
      response = { t: 3, id: call.id, payload };
    } catch {
      response = callError(call.id, 'InternalError', 'Handler failed', this.options.version);
    }
    if (this.socket.readyState === WebSocket.OPEN) this.send(response);
  }
  private rejectPending(error: Error): void {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
  async close(code = 1000): Promise<void> {
    if (this.socket.readyState === WebSocket.CLOSED) return;
    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => this.socket.terminate(), 1000);
      this.socket.once('close', () => {
        clearTimeout(timeout);
        resolve();
      });
      this.socket.close(code);
    });
  }
}
