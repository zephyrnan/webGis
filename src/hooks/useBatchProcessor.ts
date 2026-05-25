import { useCallback, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { GeoSurgicalAst } from '../types/ast';
import type { SurgeryResult } from '../types/protocol';

export type BatchItem = {
  id: string;
  fileName: string;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: SurgeryResult;
  error?: string;
};

export type BatchState = {
  items: BatchItem[];
  currentIndex: number;
  running: boolean;
};

export function useBatchProcessor() {
  const [batch, setBatch] = useState<BatchState>({ items: [], currentIndex: -1, running: false });
  const workerRef = useRef<Worker | null>(null);
  const cancelRef = useRef(false);

  const startBatch = useCallback(async (files: File[], ast: GeoSurgicalAst) => {
    cancelRef.current = false;
    const items: BatchItem[] = files.map((f) => ({
      id: nanoid(),
      fileName: f.name,
      status: 'pending' as const,
    }));
    setBatch({ items, currentIndex: 0, running: true });

    for (let i = 0; i < files.length; i++) {
      if (cancelRef.current) break;

      setBatch((prev) => ({ ...prev, currentIndex: i }));
      setBatch((prev) => ({
        ...prev,
        items: prev.items.map((item, idx) => idx === i ? { ...item, status: 'processing' } : item),
      }));

      try {
        const result = await processFile(files[i], ast, () => cancelRef.current);
        if (cancelRef.current) break;

        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((item, idx) => idx === i ? { ...item, status: 'done', result } : item),
        }));
      } catch (err) {
        setBatch((prev) => ({
          ...prev,
          items: prev.items.map((item, idx) => idx === i ? {
            ...item,
            status: 'error',
            error: err instanceof Error ? err.message : String(err),
          } : item),
        }));
      }
    }

    setBatch((prev) => ({ ...prev, running: false }));
  }, []);

  const cancelBatch = useCallback(() => {
    cancelRef.current = true;
    workerRef.current?.terminate();
    workerRef.current = null;
    setBatch((prev) => ({ ...prev, running: false }));
  }, []);

  const clearBatch = useCallback(() => {
    setBatch({ items: [], currentIndex: -1, running: false });
  }, []);

  return { batch, startBatch, cancelBatch, clearBatch };
}

function processFile(file: File, ast: GeoSurgicalAst, isCancelled: () => boolean): Promise<SurgeryResult> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('../workers/geosurgical.worker.ts', import.meta.url), { type: 'module' });

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Processing timeout'));
    }, 5 * 60 * 1000);

    worker.onmessage = (event) => {
      const response = event.data;
      if (isCancelled()) {
        worker.terminate();
        clearTimeout(timeout);
        reject(new Error('Cancelled'));
        return;
      }
      if (response.type === 'RESULT_READY') {
        worker.terminate();
        clearTimeout(timeout);
        resolve(response.result);
      }
      if (response.type === 'ERROR') {
        worker.terminate();
        clearTimeout(timeout);
        reject(new Error(response.error.message));
      }
    };

    worker.onerror = (event) => {
      worker.terminate();
      clearTimeout(timeout);
      reject(new Error(event.message));
    };

    // Upload file first, then execute AST
    void file.arrayBuffer().then((buffer) => {
      const taskId = nanoid();
      worker.postMessage(
        { type: 'UPLOAD_FILE', taskId, fileName: file.name, fileSize: file.size, buffer },
        [buffer],
      );

      // Wait for metadata before executing
      const metaHandler = (e: MessageEvent) => {
        if (e.data.type === 'METADATA_READY') {
          worker.removeEventListener('message', metaHandler);
          worker.postMessage({ type: 'EXECUTE_AST', taskId, ast });
        }
      };
      worker.addEventListener('message', metaHandler);
    });
  });
}
