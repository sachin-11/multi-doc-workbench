import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './env.js';

/*
 * Config is validated at startup. Invalid values must fail fast with a message that names the variable,
 * instead of starting the server with a silently wrong limit.
 */
describe('loadConfig', () => {
  it('uses safe defaults when nothing is set, and treats an empty API key as "use MOCK"', () => {
    const config = loadConfig({ LLM_API_KEY: '' });
    expect(config.MAX_FILE_SIZE_MB).toBe(10);
    expect(config.MAX_FILES).toBe(10);
    expect(config.LLM_API_KEY).toBeUndefined();
    expect(path.isAbsolute(config.DB_PATH)).toBe(true);
    expect(config.DB_PATH.endsWith(path.join('data', 'app.db'))).toBe(true);
  });

  it('treats a whitespace-only API key as not set', () => {
    expect(loadConfig({ LLM_API_KEY: '   ' }).LLM_API_KEY).toBeUndefined();
  });

  it('keeps ":memory:" for tests instead of resolving it as a path', () => {
    expect(loadConfig({ DB_PATH: ':memory:' }).DB_PATH).toBe(':memory:');
  });

  it.each(['abc', '0', '-5', '500'])('fails fast on MAX_FILE_SIZE_MB=%s and names the variable', (value) => {
    expect(() => loadConfig({ MAX_FILE_SIZE_MB: value })).toThrow(/Invalid environment configuration[\s\S]*MAX_FILE_SIZE_MB/);
  });

  it('fails fast on a malformed CLIENT_ORIGIN', () => {
    expect(() => loadConfig({ CLIENT_ORIGIN: 'not a url' })).toThrow(/CLIENT_ORIGIN/);
  });

  it('fails fast on an out-of-range processing timeout', () => {
    expect(() => loadConfig({ PROCESSING_TIMEOUT_MS: '10' })).toThrow(/PROCESSING_TIMEOUT_MS/);
  });
});
