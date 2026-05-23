// Renderer-side wrapper around the main-process Completion seam
// (electronAPI.ai.complete). Generates a requestId and wires the AbortSignal
// to ai.cancel so an in-flight request is truly aborted in main, while
// abortable() rejects the renderer the moment the signal fires.
//
// Shared by the analysis pipeline (fileProcessor) and transcript validation
// so there's one place that knows how to call the seam with cancellation.

import { abortable } from '../utils/cancellation';

export interface AiCompletionResult {
  ok: boolean;
  text: string;
  raw: string;
  data: any | null;
  error?: string;
}

export async function aiComplete(
  prompt: string,
  expects: 'text' | 'json',
  signal?: AbortSignal
): Promise<AiCompletionResult> {
  const requestId = `ai-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  const onAbort = () => {
    void window.electronAPI.ai.cancel(requestId);
  };
  signal?.addEventListener('abort', onAbort, { once: true });
  try {
    const res = await abortable(
      window.electronAPI.ai.complete({ prompt, expects, requestId }),
      signal
    );
    return {
      ok: !!res.ok,
      text: res.text || '',
      raw: res.raw || '',
      data: res.data ?? null,
      error: res.error,
    };
  } finally {
    signal?.removeEventListener('abort', onAbort);
  }
}
