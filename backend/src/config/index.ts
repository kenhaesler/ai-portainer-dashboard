import { envSchema, type EnvConfig } from './env.schema.js';

let config: EnvConfig | null = null;

export function getConfig(): EnvConfig {
  if (!config) {
    const result = envSchema.safeParse(process.env);
    if (!result.success) {
      const errors = result.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid environment configuration:\n${errors}`);
    }
    config = result.data;
  }
  return config;
}

export type { EnvConfig };
