// @vitest-environment node
//
// Tests for the serial mutex that guards transcript processing. Critical
// invariants: only one task runs at a time, order is preserved, results pass
// through, and one task's failure doesn't poison the chain for the next.

import { describe, it, expect } from 'vitest';
import { runSerial } from '../src/services/processingScheduler';

const defer = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => {
    resolve = r;
  });
  return { promise, resolve };
};

describe('processingScheduler.runSerial', () => {
  it('runs tasks one at a time (never overlaps)', async () => {
    let active = 0;
    let maxActive = 0;
    const make = () => async () => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      active--;
      return active;
    };
    await Promise.all([runSerial(make()), runSerial(make()), runSerial(make())]);
    expect(maxActive).toBe(1);
  });

  it('preserves FIFO order', async () => {
    const order: number[] = [];
    const p1 = runSerial(async () => {
      await new Promise((r) => setTimeout(r, 10));
      order.push(1);
    });
    const p2 = runSerial(async () => {
      await new Promise((r) => setTimeout(r, 1));
      order.push(2);
    });
    const p3 = runSerial(async () => {
      order.push(3);
    });
    await Promise.all([p1, p2, p3]);
    expect(order).toEqual([1, 2, 3]);
  });

  it('returns each task result to its own caller', async () => {
    const [a, b] = await Promise.all([
      runSerial(async () => 'a'),
      runSerial(async () => 'b'),
    ]);
    expect([a, b]).toEqual(['a', 'b']);
  });

  it('a rejected task does not poison the chain', async () => {
    const failing = runSerial(async () => {
      throw new Error('boom');
    });
    await expect(failing).rejects.toThrow('boom');
    // the next task still runs
    await expect(runSerial(async () => 'ok')).resolves.toBe('ok');
  });

  it('a slow failing task still releases the lock for the next', async () => {
    const gate = defer();
    let secondRan = false;
    const first = runSerial(async () => {
      await gate.promise;
      throw new Error('late failure');
    });
    const second = runSerial(async () => {
      secondRan = true;
      return 'second';
    });
    expect(secondRan).toBe(false); // blocked behind the first
    gate.resolve();
    await expect(first).rejects.toThrow('late failure');
    await expect(second).resolves.toBe('second');
    expect(secondRan).toBe(true);
  });
});
