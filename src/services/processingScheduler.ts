// Module-level serial mutex for transcript processing.
//
// Why: each /analyse call uses ~100% of one CPU for ~real-time. Running two
// in parallel doesn't make the total faster — the sidecar is single-worker
// — and the second one's fetch can hit undici's headers timeout while it
// waits its turn. So we explicitly serialise every processing job across
// the whole renderer, regardless of which upload entry-point started it.
//
// Items remain visible in the ProcessingQueue with status='queued' while
// they wait, so the user always sees their place in line.

let chain: Promise<unknown> = Promise.resolve();

export function runSerial<T>(task: () => Promise<T>): Promise<T> {
  const wait = chain;
  let release: () => void;
  chain = new Promise<void>(r => { release = r; });
  return wait
    .catch(() => undefined) // never let one failure poison the chain
    .then(task)
    .finally(() => release!());
}
