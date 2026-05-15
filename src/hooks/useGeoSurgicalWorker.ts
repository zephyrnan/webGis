import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import type { GeoSurgicalAst } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { ProgressEvent, StructuredError, SurgeryResult, UndoCapability, WorkerRequest, WorkerResponse } from '../types/protocol';

export type WorkerStatus =
  | 'idle'
  | 'uploading'
  | 'metadata-extracting'
  | 'ready'
  | 'executing'
  | 'completed'
  | 'failed'
  | 'cancelled';

export function useGeoSurgicalWorker() {
  const workerRef = useRef<Worker | null>(null);
  const taskIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<WorkerStatus>('idle');
  const [metadata, setMetadata] = useState<GeoSurgicalMetadata | null>(null);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<StructuredError | null>(null);
  const [result, setResult] = useState<SurgeryResult | null>(null);
  const [undo, setUndo] = useState<UndoCapability | null>(null);

  useEffect(() => {
    const worker = new Worker(new URL('../workers/geosurgical.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.type === 'PROGRESS') {
        setProgress((items) => [...items, response.progress]);
        return;
      }

      if (response.type === 'METADATA_READY') {
        setMetadata(response.metadata);
        setStatus('ready');
        return;
      }

      if (response.type === 'RESULT_READY') {
        setResult(response.result);
        setUndo(response.undo);
        setStatus('completed');
        return;
      }

      if (response.type === 'ERROR') {
        setError(response.error);
        setStatus(response.error.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed');
      }
    };

    worker.onerror = () => {
      setError({ code: 'WORKER_RUNTIME_ERROR', message: 'Worker 运行时错误。', recoverable: false });
      setStatus('failed');
    };

    return () => worker.terminate();
  }, []);

  const post = useCallback((request: WorkerRequest, transfer?: Transferable[]) => {
    workerRef.current?.postMessage(request, transfer ?? []);
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const taskId = nanoid();
    taskIdRef.current = taskId;
    setStatus('uploading');
    setMetadata(null);
    setProgress([]);
    setError(null);
    setResult(null);
    setUndo(null);

    const buffer = await file.arrayBuffer();
    setStatus('metadata-extracting');
    post(
      {
        type: 'UPLOAD_FILE',
        taskId,
        fileName: file.name,
        fileSize: file.size,
        buffer,
      },
      [buffer],
    );
  }, [post]);

  const executeAst = useCallback((ast: GeoSurgicalAst) => {
    const taskId = taskIdRef.current;
    if (!taskId) return;

    setStatus('executing');
    setError(null);
    setResult(null);
    setUndo(null);
    post({ type: 'EXECUTE_AST', taskId, ast });
  }, [post]);

  const cancelTask = useCallback(() => {
    const taskId = taskIdRef.current;
    if (!taskId) return;

    setStatus('cancelled');
    post({ type: 'CANCEL_TASK', taskId });
  }, [post]);

  return useMemo(() => ({
    status,
    metadata,
    progress,
    error,
    result,
    undo,
    uploadFile,
    executeAst,
    cancelTask,
  }), [status, metadata, progress, error, result, undo, uploadFile, executeAst, cancelTask]);
}
