import { z } from 'zod';

export const EnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  HOST: z.string().default('0.0.0.0'),
  DATABASE_URL: z
    .string()
    .url()
    .default('postgresql://proofmesh:proofmesh_dev@localhost:5432/proofmesh_dev'),
  JWT_SECRET: z.string().min(16).default('development_jwt_secret_must_be_changed_in_prod'),
  FAIL_POLICY: z.enum(['fail_open', 'fail_closed']).default('fail_closed'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info')
});

export type EnvConfig = z.infer<typeof EnvSchema>;

export function loadAndValidateEnv(
  sourceEnv: Record<string, string | undefined> = process.env
): EnvConfig {
  const result = EnvSchema.safeParse(sourceEnv);
  if (!result.success) {
    const errorDetails = result.error.errors
      .map((err) => `  - ${err.path.join('.')}: ${err.message}`)
      .join('\n');
    throw new Error(
      `[ProofMesh Configuration Failure] Invalid or missing environment variables:\n${errorDetails}`
    );
  }
  return result.data;
}
