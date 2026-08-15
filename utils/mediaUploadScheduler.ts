type QueueItem<T> = {
  task: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export class MediaUploadScheduler {
  private active = 0;
  private readonly queue: QueueItem<unknown>[] = [];
  private readonly concurrency: number;

  constructor(concurrency = 3) {
    this.concurrency = concurrency;
  }

  schedule<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ task, resolve: resolve as (value: unknown) => void, reject });
      this.drain();
    });
  }

  private drain(): void {
    while (this.active < this.concurrency && this.queue.length > 0) {
      const item = this.queue.shift()!;
      this.active += 1;
      item.task()
        .then(item.resolve, item.reject)
        .finally(() => {
          this.active -= 1;
          this.drain();
        });
    }
  }
}

export const mediaUploadScheduler = new MediaUploadScheduler(3);
