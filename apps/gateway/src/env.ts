import { z } from 'zod';

const envSchema = z.object({
  FLY_APP_NAME: z.string().min(1).optional(),
  DATABASE_URL: z
    .url()
    .refine((value) => /^postgres(?:ql)?:\/\//.test(value), 'Expected PostgreSQL URL'),
  CREDENTIALS_ENC_KEY: z.string().refine((value) => {
    const key = Buffer.from(value, 'base64');
    return key.length === 32 && key.toString('base64') === value;
  }, 'Expected a base64 encoded 32-byte key'),
  INTERNAL_API_SECRET: z.string().min(32),
  STREAM_TOKEN_SECRET: z.string().min(32),
  DASHBOARD_ORIGIN: z.url(),
  ALLOW_INSECURE_WS: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  RETENTION_DAYS: z.coerce.number().int().positive().default(30),
  RESEND_API_KEY: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  PORT: z.coerce.number().int().min(0).max(65535).default(8080),
});
export function parseEnv(env: NodeJS.ProcessEnv) {
  const result = envSchema.safeParse(env);
  if (!result.success)
    throw new Error(
      `Invalid gateway environment: ${result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ')}`,
    );
  return result.data;
}
