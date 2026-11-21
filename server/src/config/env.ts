import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the root-level .env regardless of the working directory npm uses.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Empty string means "not set" -> MOCK LLM provider is used (M5).
  LLM_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().default(5),
  MAX_FILES: z.coerce.number().int().positive().default(10),
});

export type Config = z.infer<typeof EnvSchema>;

/** Parses and validates environment variables. Throws with a readable message on invalid config. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): Config {
  const parsed = EnvSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${details}`);
  }
  return parsed.data;
}
