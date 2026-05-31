import { useCallback, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { GeoSurgicalAst } from '../types/ast';
import type { SurgeryResult, ProgressEvent } from '../types/protocol';
import { WorkerPool, type BatchTaskInput } from '../workers/workerPool';

export type BatchItem = {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  progress?: ProgressEvent;
  result?: SurgeryResult;
  error?: string;
};

export type BatchState = {
  items: BatchItem[];
  currentIndex: number;
  running: boolean;
  concurrency: number;
};

export function useBatchProcessor() {
  const [batch, setBatch] = useState<BatchState>({ items: [], currentIndex: -1, running: false, concurrency: 1 });
  const poolRef = useRef<WorkerPool | null>(null);

  const startBatch = useCallback(async (files: File[], ast: GeoSurgicalAst) => {
    const pool = new WorkerPool();
    poolRef.current = pool;

    const items: BatchItem[] = files.map((f) => ({
      id: nanoid(),
      fileName: f.name,
      status: 'pending' as const,
    }));

    setBatch({ items, currentIndex: 0, running: true, concurrency: pool.concurrency });

    const inputs: BatchTaskInput[] = items.map((item, i) => ({
      id: item.id,
      file: files[i],
    }));

    await new Promise<void>((resolveAll) => {
      let completed = 0;

      pool.processAll(
        inputs,
        ast,
        // onProgress
        (taskId, update) => {
          if (!update.progress) return;
          setBatch((prev) => ({
            ...prev,
            items: prev.items.map((it) =>
              it.id === taskId ? { ...it, status: 'processing', progress: update.progress } : it
            ),
          }));
        },
        // onFileDone
        (taskId, result) => {
          setBatch((prev) => ({
            ...prev,
            items: prev.items.map((it) =>
              it.id === taskId ? { ...it, status: 'done', result, progress: undefined } : it
            ),
          }));
          completed++;
          if (completed >= files.length) resolveAll();
        },
        // onFileError
        (taskId, error) => {
          setBatch((prev) => ({
            ...prev,
            items: prev.items.map((it) =>
              it.id === taskId ? { ...it, status: 'error', error, progress: undefined } : it
            ),
          }));
          completed++;
          if (completed >= files.length) resolveAll();
        },
      );
    });

    setBatch((prev) => ({ ...prev, running: false }));
    poolRef.current = null;
  }, []);

  const cancelBatch = useCallback(() => {
    poolRef.current?.cancel();
    poolRef.current = null;
    setBatch((prev) => ({ ...prev, running: false }));
  }, []);

  const clearBatch = useCallback(() => {
    poolRef.current?.cancel();
    poolRef.current = null;
    setBatch({ items: [], currentIndex: -1, running: false, concurrency: 1 });
  }, []);

  return { batch, startBatch, cancelBatch, clearBatch };
}
