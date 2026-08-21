export interface MentionSearchCallbacks<T> {
  onStart?: () => void;
  onSuccess: (results: T[]) => void;
  onError?: (error: unknown) => void;
  onSettled?: () => void;
}

export interface MentionSearchScheduler<T> {
  schedule: (query: string, callbacks: MentionSearchCallbacks<T>) => void;
  cancel: () => void;
}

export const createMentionSearchScheduler = <T>(
  search: (query: string, signal: AbortSignal) => Promise<T[]>,
  delayMs = 300,
): MentionSearchScheduler<T> => {
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;

  const cancel = () => {
    generation += 1;
    if (timer) clearTimeout(timer);
    timer = undefined;
    controller?.abort();
    controller = undefined;
  };

  const schedule = (query: string, callbacks: MentionSearchCallbacks<T>) => {
    cancel();
    const scheduledGeneration = generation;
    controller = new AbortController();
    const scheduledController = controller;

    timer = setTimeout(async () => {
      if (generation !== scheduledGeneration) return;
      callbacks.onStart?.();
      try {
        const results = await search(query, scheduledController.signal);
        if (generation === scheduledGeneration) callbacks.onSuccess(results);
      } catch (error) {
        if (generation === scheduledGeneration && !scheduledController.signal.aborted) callbacks.onError?.(error);
      } finally {
        if (generation === scheduledGeneration) callbacks.onSettled?.();
      }
    }, delayMs);
  };

  return { schedule, cancel };
};
