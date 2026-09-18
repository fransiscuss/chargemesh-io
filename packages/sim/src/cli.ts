import { parseArgs } from 'node:util';
import { SimCharger } from './simCharger.js';
import { runScenario } from './scenarios.js';

export function parseCliArgs(args: string[]) {
  const { values } = parseArgs({
    args,
    options: {
      url: { type: 'string' },
      id: { type: 'string' },
      version: { type: 'string', default: '1.6' },
      password: { type: 'string' },
      scenario: { type: 'string', default: 'boot' },
      'id-tag': { type: 'string', default: 'TEST-TAG' },
    },
  });
  if (!values.url || !values.id) throw new Error('Required: --url ws://host/path --id SIM001');
  if (values.version !== '1.6' && values.version !== '2.0.1')
    throw new Error('--version must be 1.6 or 2.0.1');
  if (values.scenario !== 'boot' && values.scenario !== 'full-session')
    throw new Error('--scenario must be boot or full-session');
  return {
    url: values.url,
    id: values.id,
    version: values.version,
    scenario: values.scenario,
    idTag: values['id-tag'],
    ...(values.password === undefined ? {} : { password: values.password }),
  } as const;
}
export async function runCli(
  args: string[],
  log: (line: string) => void = console.log,
): Promise<void> {
  const options = parseCliArgs(args);
  const charger = await SimCharger.connect(options);
  try {
    const responses = await runScenario(charger, options.version, options.scenario, {
      idTag: options.idTag,
    });
    log(`Completed ${options.scenario} (${options.version}): ${responses.length} calls`);
  } finally {
    await charger.close();
  }
}
if (import.meta.main) {
  runCli(process.argv.slice(2)).catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : 'Simulator failed');
    process.exitCode = 1;
  });
}
