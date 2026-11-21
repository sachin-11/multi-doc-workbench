/**
 * In-process store for raw upload bytes, keyed by document id.
 *
 * KNOWN LIMITATION: memory only. Contents are lost on restart and are not shared between
 * server instances. Entries expire after `ttlMs`. Production would use object storage (S3 or similar)
 * with the same keys.
 */
export interface BufferStore {
  put(id: string, buffer: Buffer): void;
  get(id: string): Buffer | undefined;
  delete(id: string): boolean;
  /** Removes expired entries. Returns how many were removed. */
  sweep(): number;
  size(): number;
  close(): void;
}

interface Entry {
  buffer: Buffer;
  expiresAt: number;
}

export interface BufferStoreOptions {
  ttlMs: number;
  /** 0 disables the background sweep (tests call sweep() directly). */
  sweepIntervalMs?: number;
  now?: () => number;
}

export function createBufferStore(options: BufferStoreOptions): BufferStore {
  const now = options.now ?? (() => Date.now());
  const entries = new Map<string, Entry>();

  const sweep = (): number => {
    const current = now();
    let removed = 0;
    for (const [id, entry] of entries) {
      if (entry.expiresAt <= current) {
        entries.delete(id);
        removed += 1;
      }
    }
    return removed;
  };

  const sweepIntervalMs = options.sweepIntervalMs ?? 60_000;
  const timer =
    sweepIntervalMs > 0
      ? setInterval(sweep, sweepIntervalMs).unref()
      : undefined;

  return {
    put(id, buffer) {
      entries.set(id, { buffer, expiresAt: now() + options.ttlMs });
    },

    get(id) {
      const entry = entries.get(id);
      if (!entry) return undefined;
      if (entry.expiresAt <= now()) {
        entries.delete(id);
        return undefined;
      }
      return entry.buffer;
    },

    delete(id) {
      return entries.delete(id);
    },

    sweep,

    size() {
      return entries.size;
    },

    close() {
      if (timer) clearInterval(timer);
      entries.clear();
    },
  };
}
