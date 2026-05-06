// Cancellation helpers for long-running pipelines (transcription, analysis).
//
// Electron IPC does not propagate AbortSignal to the main process, so we
// can't truly cancel an in-flight whisper run or chatWithOllama call from
// the renderer. Instead, we race the IPC promise against the abort signal:
// the renderer stops awaiting immediately on cancel, and the now-orphaned
// IPC call completes harmlessly in main and its result is discarded.

export class CancelledError extends Error {
  constructor(message = 'Cancelled by user') {
    super(message);
    this.name = 'CancelledError';
  }
}

// Recognises both our CancelledError and the DOMException that fetch
// throws when its AbortSignal fires (`error.name === 'AbortError'`).
export function isCancelled(err: unknown): boolean {
  if (err instanceof CancelledError) return true;
  if (err instanceof Error && (err.name === 'CancelledError' || err.name === 'AbortError')) return true;
  return false;
}

// Throws CancelledError if the signal has aborted. Call this between stages.
export function checkCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw new CancelledError();
}

// Wraps a promise so it rejects with CancelledError as soon as the signal
// fires, even if the underlying promise is still pending. The underlying
// promise continues running but its result is ignored.
export function abortable<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(new CancelledError());

  return new Promise<T>((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort);
      reject(new CancelledError());
    };
    signal.addEventListener('abort', onAbort, { once: true });
    promise.then(
      (val) => {
        signal.removeEventListener('abort', onAbort);
        resolve(val);
      },
      (err) => {
        signal.removeEventListener('abort', onAbort);
        reject(err);
      }
    );
  });
}
