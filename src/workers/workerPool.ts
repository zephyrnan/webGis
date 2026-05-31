import { nanoid } from 'nanoid';
import type { GeoSurgicalAst } from '../types/ast';
import type { SurgeryResult, ProgressEvent } from '../types/protocol';

export type BatchProgress = {
  progress?: ProgressEvent;
  result?: SurgeryResult;
  error?: string;
};

type PoolTask = {
  id: string;
  file: File;
  ast: GeoSurgicalAst;
  retries: number;
  resolve: (result: SurgeryResult) => void;
  reject: (error: Error) => void;
  onProgress?: (evt: ProgressEvent) => void;
};

const MAX_RETRIES = 1;
const TIMEOUT_MS = 5 * 60 * 1000;

export type BatchTaskInput = {
  id: string;
  file: File;
};

export class WorkerPool {
  private poolSize: number;
  private activeWorkers = new Map<string, Worker>();
  private activeTasks = new Map<string, PoolTask>();
  private queue: PoolTask[] = [];
  private cancelled = false;

  constructor() {
    const cores = typeof navigator !== 'undefined' ? navigator.hardwareConcurrency ?? 4 : 4;
    this.poolSize = Math.max(1, Math.min(4, cores - 1));
  }

  get concurrency(): number {
    return this.poolSize;
  }

  get activeCount(): number {
    return this.activeWorkers.size;
  }

  get queueLength(): number {
    return this.queue.length;
  }

  async processAll(
    inputs: BatchTaskInput[],
    ast: GeoSurgicalAst,
    onProgress: (taskId: string, update: BatchProgress) => void,
    onFileDone: (taskId: string, result: SurgeryResult) => void,
    onFileError: (taskId: string, error: string) => void,
  ): Promise<void> {
    this.cancelled = false;

    const tasks: PoolTask[] = inputs.map((input) => ({
      id: input.id,
      file: input.file,
      ast,
      retries: 0,
      resolve: (result) => onFileDone(input.id, result),
      reject: (err) => onFileError(input.id, err.message),
      onProgress: (evt) => onProgress(input.id, { progress: evt }),
    }));

    for (const task of tasks) {
      if (this.cancelled) break;
      this.queue.push(task);
    }
    this.drain();
  }

  cancel(): void {
    this.cancelled = true;
    this.queue = [];
    for (const [id, worker] of this.activeWorkers) {
      worker.terminate();
      this.activeWorkers.delete(id);
      this.activeTasks.delete(id);
    }
  }

  private drain(): void {
    while (this.activeWorkers.size < this.poolSize && this.queue.length > 0 && !this.cancelled) {
      const task = this.queue.shift()!;
      this.runTask(task);
    }
  }

  private runTask(task: PoolTask): void {
    const worker = new Worker(
      new URL('./geosurgical.worker.ts', import.meta.url),
      { type: 'module' },
    );
    this.activeWorkers.set(task.id, worker);
    this.activeTasks.set(task.id, task);

    const timeout = setTimeout(() => {
      worker.terminate();
      this.cleanup(task.id);
      task.reject(new Error('Processing timeout (5 min)'));
      this.drain();
    }, TIMEOUT_MS);

    worker.onmessage = (event: MessageEvent) => {
      if (this.cancelled) return;
      const msg = event.data;

      if (msg.type === 'PROGRESS') {
        task.onProgress?.(msg.progress);
      }

      if (msg.type === 'RESULT_READY') {
        clearTimeout(timeout);
        worker.terminate();
        this.cleanup(task.id);
        task.resolve(msg.result);
        this.drain();
      }

      if (msg.type === 'ERROR') {
        clearTimeout(timeout);
        worker.terminate();
        this.cleanup(task.id);

        // Retry once on error
        if (task.retries < MAX_RETRIES) {
          task.retries++;
          this.queue.unshift(task);
          this.drain();
        } else {
          task.reject(new Error(msg.error?.message ?? 'Unknown worker error'));
          this.drain();
        }
      }
    };

    worker.onerror = (event) => {
      clearTimeout(timeout);
      worker.terminate();
      this.cleanup(task.id);

      if (task.retries < MAX_RETRIES) {
        task.retries++;
        this.queue.unshift(task);
        this.drain();
      } else {
        task.reject(new Error(event.message || 'Worker error'));
        this.drain();
      }
    };

    // Upload file → wait for metadata → execute AST
    void task.file.arrayBuffer().then((buffer) => {
      if (this.cancelled) return;
      const taskId = nanoid();
      worker.postMessage(
        { type: 'UPLOAD_FILE', taskId, fileName: task.file.name, fileSize: task.file.size, buffer },
        [buffer],
      );

      const metaHandler = (e: MessageEvent) => {
        if (e.data.type === 'METADATA_READY') {
          worker.removeEventListener('message', metaHandler);
          worker.postMessage({ type: 'EXECUTE_AST', taskId, ast: task.ast });
        }
      };
      worker.addEventListener('message', metaHandler);
    });
  }

  private cleanup(id: string): void {
    this.activeWorkers.delete(id);
    this.activeTasks.delete(id);
  }
}
