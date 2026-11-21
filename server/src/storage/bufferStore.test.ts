import { describe, expect, it } from 'vitest';
import { createBufferStore } from './bufferStore.js';

describe('buffer store', () => {
  it('returns bytes until the TTL passes, then evicts them', () => {
    let clock = 0;
    const store = createBufferStore({ ttlMs: 1_000, sweepIntervalMs: 0, now: () => clock });

    store.put('doc-1', Buffer.from('hello'));
    clock = 999;
    expect(store.get('doc-1')?.toString()).toBe('hello');

    clock = 1_000;
    expect(store.get('doc-1')).toBeUndefined();
    expect(store.size()).toBe(0);
    store.close();
  });

  it('sweep() removes only expired entries', () => {
    let clock = 0;
    const store = createBufferStore({ ttlMs: 500, sweepIntervalMs: 0, now: () => clock });

    store.put('old', Buffer.from('a'));
    clock = 400;
    store.put('new', Buffer.from('b'));
    clock = 600;

    expect(store.sweep()).toBe(1);
    expect(store.get('new')).toBeDefined();
    store.close();
  });
});
