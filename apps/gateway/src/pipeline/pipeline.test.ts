import { expect, it, vi } from 'vitest';
import { parseFrame } from '@chargemesh/ocpp';
import { Pipeline } from './pipeline.js';
import { frameContext } from '../../test/helpers.js';
it('drops before forwarding but still notifies observers', async () => {
  const ctx = frameContext();
  ctx.forward = vi.fn();
  const observer = vi.fn();
  const pipeline = new Pipeline([() => ({ type: 'drop', reason: 'test' })], [observer]);
  pipeline.run(ctx, parseFrame(ctx.raw));
  expect(ctx.forward).not.toHaveBeenCalled();
  expect(ctx.delivery.dropped).toBe('test');
  await pipeline.flush();
  expect(observer).toHaveBeenCalledOnce();
});
it('rewrites structured data while preserving the original input for observers', async () => {
  const ctx = frameContext();
  ctx.forward = vi.fn(() => ['primary']);
  const observer = vi.fn();
  const pipeline = new Pipeline(
    [
      () => ({
        type: 'rewrite',
        frame: { t: 2, id: 'x', action: 'MeterValues', payload: { transactionId: 9 } },
      }),
    ],
    [observer],
  );
  pipeline.run(ctx, parseFrame(ctx.raw));
  expect(ctx.forward).toHaveBeenCalledWith('[2,"x","MeterValues",{"transactionId":9}]');
  expect(ctx.delivery.rewritten).toBe(true);
  await pipeline.flush();
  expect(observer.mock.calls[0]![1]).toEqual(parseFrame(ctx.raw));
});
it('forwards before asynchronous observers, logs failures and continues', async () => {
  const order: string[] = [];
  const ctx = frameContext();
  ctx.forward = () => {
    order.push('forward');
    return ['primary'];
  };
  const error = vi.fn();
  const pipeline = new Pipeline(
    [() => ({ type: 'pass' })],
    [
      () => {
        order.push('first');
        throw new Error('boom');
      },
      async () => {
        order.push('second');
      },
    ],
    { error },
  );
  pipeline.run(ctx, parseFrame(ctx.raw));
  expect(order).toEqual(['forward']);
  await pipeline.flush();
  expect(order).toEqual(['forward', 'first', 'second']);
  expect(error).toHaveBeenCalledOnce();
});
it('flush awaits pending asynchronous work', async () => {
  let release!: () => void;
  const work = new Promise<void>((resolve) => {
    release = resolve;
  });
  const pipeline = new Pipeline([], [() => work]);
  const ctx = frameContext();
  pipeline.run(ctx, parseFrame(ctx.raw));
  let done = false;
  const flushing = pipeline.flush().then(() => {
    done = true;
  });
  await Promise.resolve();
  expect(done).toBe(false);
  release();
  await flushing;
  expect(done).toBe(true);
});
it('records a send failure without skipping asynchronous observers', async () => {
  const ctx = frameContext();
  ctx.forward = () => {
    throw new Error('closed');
  };
  const error = vi.fn();
  const observer = vi.fn();
  const pipeline = new Pipeline([], [observer], { error });
  pipeline.run(ctx, parseFrame(ctx.raw));
  await pipeline.flush();
  expect(ctx.delivery.dropped).toBe('send_failed');
  expect(error).toHaveBeenCalledOnce();
  expect(observer).toHaveBeenCalledOnce();
});
