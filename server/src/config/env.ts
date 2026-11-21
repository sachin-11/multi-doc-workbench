import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { z } from 'zod';

// Load the root-level .env regardless of the working directory npm uses.
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(here, '../../../.env') });

const REPO_ROOT = path.resolve(here, '../../..');

const EnvSchema = z.object({
  PORT: z.coerce.number().int().positive().default(4000),
  // SQLite file. Relative paths resolve against the repo root. ":memory:" is allowed (tests).
  DB_PATH: z
    .string()
    .min(1)
    .default('./data/app.db')
    .transform((p) => (p === ':memory:' ? p : path.resolve(REPO_ROOT, p))),
  CLIENT_ORIGIN: z.string().url().default('http://localhost:5173'),
  // Empty string means "not set" -> MOCK LLM provider is used (M5).
  LLM_API_KEY: z
    .string()
    .optional()
    .transform((v) => (v && v.trim().length > 0 ? v.trim() : undefined)),
  LLM_BASE_URL: z.string().url().default('https://api.openai.com/v1'),
  LLM_MODEL: z.string().min(1).default('gpt-4o-mini'),
  MAX_FILE_SIZE_MB: z.coerce.number().positive().max(100).default(10),
  MAX_FILES: z.coerce.number().int().positive().max(50).default(10),
  // How long raw upload buffers stay in memory before they are evicted.
  BUFFER_TTL_MINUTES: z.coerce.number().int().positive().max(1440).default(60),
  // Processing (M4). Text beyond MAX_CHARS_PER_DOCUMENT is truncated and flagged.
  MAX_CHARS_PER_DOCUMENT: z.coerce.number().int().min(1000).max(500000).default(60000),
  PROCESSING_TIMEOUT_MS: z.coerce.number().int().min(1000).max(300000).default(20000),
  PROCESSING_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
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
