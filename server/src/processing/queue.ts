import { logger } from '../lib/logger.js';

/**
 * In-process task queue with a concurrency limit.
 * KNOWN LIMITATION: tasks live in memory and are lost on restart. Production would use a job
 * queue (BullMQ on Redis, or SQS) so work survives restarts and can run on other workers.
 */
export interface TaskQueue {
  push(task: () => Promise<void>): void;
  /** Resolves when no task is running or waiting. */
  whenIdle(): Promise<void>;
}

export function createTaskQueue(concurrency: number): TaskQueue {
  if (!Number.isInteger(concurrency) || concurrency < 1) {
    throw new RangeError('concurrency must be a positive integer');
  }

  const waiting: Array<() => Promise<void>> = [];
  const idleWaiters: Array<() => void> = [];
  let running = 0;

  const notifyIfIdle = (): void => {
    if (running > 0 || waiting.length > 0) return;
    for (const resolve of idleWaiters.splice(0)) resolve();
  };

  const startNext = (): void => {
    while (running < concurrency && waiting.length > 0) {
      const task = waiting.shift();
      if (!task) break;
      running += 1;
      task()
        .catch((err: unknown) => {
          // Tasks should handle their own errors. This is a last-resort guard so one failure cannot stop the queue.
          logger.error('queued task failed', { name: err instanceof Error ? err.name : 'unknown' });
        })
        .finally(() => {
          running -= 1;
          startNext();
          notifyIfIdle();
        });
    }
  };

  return {
    push(task) {
      waiting.push(task);
      startNext();
    },
    whenIdle() {
      if (running === 0 && waiting.length === 0) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.push(resolve));
    },
  };
}
