// Shared runtime-schema utilities for validating JSON that crosses a trust
// boundary — model output, provider API responses, persisted blobs. Kept here
// (not per-service) because the tolerant-array pattern is reused across the
// analysis, speaker-label, and model-metadata pipelines.

import { z } from 'zod';

/**
 * Array field that never throws: each element is validated with `element` and
 * dropped if it does not conform; a non-array input yields `[]`. Use this for
 * every list an external source returns so one malformed element can't poison
 * the lot (nor drop the rest, since each element is parsed independently).
 */
export function tolerantArray<T extends z.ZodTypeAny>(element: T) {
  return z
    .array(z.unknown())
    .catch([])
    .transform((arr): z.infer<T>[] => {
      const out: z.infer<T>[] = [];
      for (const el of arr) {
        const parsed = element.safeParse(el);
        if (parsed.success) out.push(parsed.data);
      }
      return out;
    });
}
