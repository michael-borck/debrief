import { describe, it, expect, vi } from 'vitest';
import { CancelledError, isCancelled, checkCancelled, abortable } from '../src/utils/cancellation';

describe('CancelledError', () => {
  it('has the expected name', () => {
    const err = new CancelledError();
    expect(err.name).toBe('CancelledError');
    expect(err).toBeInstanceOf(Error);
  });
});

describe('isCancelled', () => {
  it('detects CancelledError', () => {
    expect(isCancelled(new CancelledError())).toBe(true);
  });

  it('detects fetch AbortError', () => {
    // DOMException isn't always available in test env; simulate by name.
    const err = new Error('Aborted');
    err.name = 'AbortError';
    expect(isCancelled(err)).toBe(true);
  });

  it('returns false for ordinary errors', () => {
    expect(isCancelled(new Error('boom'))).toBe(false);
    expect(isCancelled(null)).toBe(false);
    expect(isCancelled('string error')).toBe(false);
  });
});

describe('checkCancelled', () => {
  it('does nothing when signal is undefined', () => {
    expect(() => checkCancelled(undefined)).not.toThrow();
  });

  it('does nothing when signal is not aborted', () => {
    const ctrl = new AbortController();
    expect(() => checkCancelled(ctrl.signal)).not.toThrow();
  });

  it('throws CancelledError when signal is aborted', () => {
    const ctrl = new AbortController();
    ctrl.abort();
    expect(() => checkCancelled(ctrl.signal)).toThrow(CancelledError);
  });
});

describe('abortable', () => {
  it('resolves with the underlying value when never aborted', async () => {
    const ctrl = new AbortController();
    const result = await abortable(Promise.resolve(42), ctrl.signal);
    expect(result).toBe(42);
  });

  it('rejects with CancelledError when aborted before settling', async () => {
    const ctrl = new AbortController();
    let resolveLater!: (v: number) => void;
    const slow = new Promise<number>((resolve) => { resolveLater = resolve; });
    const racing = abortable(slow, ctrl.signal);
    ctrl.abort();
    await expect(racing).rejects.toBeInstanceOf(CancelledError);
    // resolving late shouldn't cause unhandled rejection
    resolveLater(1);
  });

  it('rejects immediately if signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(abortable(Promise.resolve('x'), ctrl.signal)).rejects.toBeInstanceOf(CancelledError);
  });

  it('passes through original errors when signal is not aborted', async () => {
    const ctrl = new AbortController();
    const failing = Promise.reject(new Error('original failure'));
    await expect(abortable(failing, ctrl.signal)).rejects.toThrow('original failure');
  });

  it('returns the original promise when no signal is given', async () => {
    const p = Promise.resolve('hello');
    expect(await abortable(p)).toBe('hello');
  });

  it('removes the abort listener after the promise settles', async () => {
    const ctrl = new AbortController();
    const removeSpy = vi.spyOn(ctrl.signal, 'removeEventListener');
    await abortable(Promise.resolve('done'), ctrl.signal);
    expect(removeSpy).toHaveBeenCalled();
  });
});
