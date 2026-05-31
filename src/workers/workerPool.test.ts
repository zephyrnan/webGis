import { describe, expect, it } from 'vitest';
import { WorkerPool } from './workerPool';

describe('WorkerPool', () => {
  it('creates a pool with concurrency based on hardware concurrency', () => {
    const pool = new WorkerPool();
    // In jsdom, hardwareConcurrency is undefined → fallback to 4 → poolSize = min(4, 4-1) = 3
    expect(pool.concurrency).toBeGreaterThanOrEqual(1);
    expect(pool.concurrency).toBeLessThanOrEqual(4);
  });

  it('starts with no active workers and empty queue', () => {
    const pool = new WorkerPool();
    expect(pool.activeCount).toBe(0);
    expect(pool.queueLength).toBe(0);
  });

  it('cancel terminates all workers without error', () => {
    const pool = new WorkerPool();
    // Should not throw even with no active workers
    pool.cancel();
    expect(pool.activeCount).toBe(0);
    expect(pool.queueLength).toBe(0);
  });
});
