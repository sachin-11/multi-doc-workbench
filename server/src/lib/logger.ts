type Level = 'info' | 'warn' | 'error';
type Fields = Readonly<Record<string, string | number | boolean | null>>;

/**
 * Minimal logger. Callers pass identifiers and counts only (document ids, codes, sizes).
 * Never pass file contents or raw user text into `fields`.
 */
function write(level: Level, message: string, fields: Fields = {}): void {
  const suffix = Object.entries(fields)
    .map(([key, value]) => `${key}=${String(value)}`)
    .join(' ');
  const line = `${new Date().toISOString()} ${level.toUpperCase()} ${message}${suffix ? ` ${suffix}` : ''}`;
  if (level === 'error') {
    console.error(line);
  } else if (level === 'warn') {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export const logger = {
  info: (message: string, fields?: Fields) => write('info', message, fields),
  warn: (message: string, fields?: Fields) => write('warn', message, fields),
  error: (message: string, fields?: Fields) => write('error', message, fields),
};
