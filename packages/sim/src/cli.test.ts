import { expect, it, vi } from 'vitest';
import { parseCliArgs, runCli } from './cli.js';
import { MockCsms } from './mockCsms.js';

it('parses required parameters and validates version/scenario', () => {
  expect(parseCliArgs(['--url', 'ws://localhost', '--id', 'SIM001'])).toMatchObject({
    version: '1.6',
    scenario: 'boot',
  });
  expect(() => parseCliArgs([])).toThrow('Required');
  expect(() => parseCliArgs(['--url', 'ws://localhost', '--id', 'x', '--version', '2.1'])).toThrow(
    '--version',
  );
  expect(() =>
    parseCliArgs(['--url', 'ws://localhost', '--id', 'x', '--scenario', 'unknown']),
  ).toThrow('--scenario');
});
it('runs the CLI workflow and closes its connection', async () => {
  const mock = await MockCsms.start();
  try {
    const log = vi.fn();
    await runCli(
      ['--url', mock.url, '--id', 'CLI', '--password', 'secret', '--scenario', 'full-session'],
      log,
    );
    expect(log).toHaveBeenCalledWith('Completed full-session (1.6): 8 calls');
  } finally {
    await mock.close();
  }
});
