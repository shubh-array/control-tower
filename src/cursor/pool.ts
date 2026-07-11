
export interface PoolConfig {
  maxConcurrent: number; // 1 or 2
}

interface QueuedWork<T> {
  id: string;
  execute: () => Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
}

export class WorkerPool<T> {
  private active = 0;
  private queue: QueuedWork<T>[] = [];

  constructor(private config: PoolConfig) {
    if (config.maxConcurrent < 1 || config.maxConcurrent > 2) {
      throw new Error(`maxConcurrent must be 1 or 2, got ${config.maxConcurrent}`);
    }
  }

  submit(id: string, execute: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.queue.push({ id, execute, resolve, reject });
      this.drain();
    });
  }

  get activeCount(): number {
    return this.active;
  }

  get queuedCount(): number {
    return this.queue.length;
  }

  private drain(): void {
    while (this.active < this.config.maxConcurrent && this.queue.length > 0) {
      const work = this.queue.shift()!;
      this.active++;
      work.execute()
        .then(work.resolve)
        .catch(work.reject)
        .finally(() => {
          this.active--;
          this.drain();
        });
    }
  }
}
