import { EventEmitter } from 'node:events';
import WebSocket from 'ws';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { RpcPeer } from './rpcPeer.js';

class FakeSocket extends EventEmitter {
  readyState = WebSocket.OPEN as number;
  send = vi.fn();
  close = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
  terminate = vi.fn(() => {
    this.readyState = WebSocket.CLOSED;
    this.emit('close');
  });
}
let socket: FakeSocket;
let peer: RpcPeer;
beforeEach(() => {
  vi.useFakeTimers();
  socket = new FakeSocket();
  peer = new RpcPeer(socket as unknown as WebSocket, {
    version: '1.6',
    idGenerator: () => 'id',
    timeoutMs: 100,
  });
});
afterEach(() => {
  socket.emit('close');
  vi.useRealTimers();
});
it('cleans pending calls on close', async () => {
  const result = expect(peer.call('Heartbeat', {})).rejects.toThrow('Connection closed');
  socket.emit('close');
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
it('cleans pending calls on errors', async () => {
  const result = expect(peer.call('Heartbeat', {})).rejects.toThrow('WebSocket error');
  socket.emit('error', new Error('failed'));
  await result;
  expect(vi.getTimerCount()).toBe(0);
});
it('rejects disconnected calls and duplicate pending IDs', async () => {
  const first = peer.call('Heartbeat', {});
  await expect(peer.call('Heartbeat', {})).rejects.toThrow('Duplicate');
  socket.emit('message', Buffer.from('[3,"id",{}]'));
  await first;
  socket.readyState = WebSocket.CLOSED;
  await expect(peer.call('Heartbeat', {})).rejects.toThrow('not open');
});
it('cleans up synchronous send failures', async () => {
  socket.send.mockImplementationOnce(() => {
    throw new Error('send failed');
  });
  await expect(peer.call('Heartbeat', {})).rejects.toThrow('send failed');
  expect(vi.getTimerCount()).toBe(0);
});
it('ignores malformed and unmatched responses', async () => {
  socket.emit('message', Buffer.from('invalid'));
  socket.emit('message', Buffer.from('[3,"unmatched",{}]'));
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.send).not.toHaveBeenCalled();
});
it('gracefully closes, is idempotent, and terminates an unresponsive peer', async () => {
  await peer.close();
  await peer.close();
  expect(socket.close).toHaveBeenCalledTimes(1);
  socket.readyState = WebSocket.OPEN;
  socket.close.mockImplementationOnce(() => undefined);
  const close = peer.close();
  await vi.advanceTimersByTimeAsync(1000);
  await close;
  expect(socket.terminate).toHaveBeenCalledOnce();
});
it('does not send a delayed handler result after disconnect', async () => {
  let complete!: (value: Record<string, unknown>) => void;
  peer.onCall(
    'Delay',
    () =>
      new Promise((resolve) => {
        complete = resolve;
      }),
  );
  socket.emit('message', Buffer.from('[2,"server","Delay",{}]'));
  socket.readyState = WebSocket.CLOSED;
  complete({});
  await vi.advanceTimersByTimeAsync(0);
  expect(socket.send).not.toHaveBeenCalled();
});
