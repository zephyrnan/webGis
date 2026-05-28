import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nanoid } from 'nanoid';
import * as Sentry from '@sentry/react';
import type { GeoSurgicalAst } from '../types/ast';
import type { HistoryEntry, HistoryState } from '../types/history';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { ProgressEvent, StructuredError, SurgeryResult, UndoCapability, WorkerRequest, WorkerResponse } from '../types/protocol';
import { saveSession } from '../services/history';

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
  const fileRef = useRef<File | null>(null);
  const [status, setStatus] = useState<WorkerStatus>('idle');
  const [engineMode, setEngineMode] = useState<'real' | 'mock' | 'loading'>('loading');
  const [wasmError, setWasmError] = useState<string | null>(null);
  const [metadata, setMetadata] = useState<GeoSurgicalMetadata | null>(null);
  const [progress, setProgress] = useState<ProgressEvent[]>([]);
  const [error, setError] = useState<StructuredError | null>(null);
  const [result, setResult] = useState<SurgeryResult | null>(null);
  const [undo, setUndo] = useState<UndoCapability | null>(null);
  const [history, setHistory] = useState<HistoryState>({ entries: [], currentIndex: -1 });
  const lastAstRef = useRef<GeoSurgicalAst | null>(null);
  const lastCommandRef = useRef('');
  const lastFileNameRef = useRef('');

  const setupWorker = useCallback(() => {
    const worker = new Worker(new URL('../workers/geosurgical.worker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;

    worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
      const response = event.data;

      if (response.type === 'ENGINE_STATUS') {
        setEngineMode(response.mode);
        setWasmError(response.wasmError ?? null);
        return;
      }

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
        setUndo(response.undo);
        setStatus('completed');
        if (lastAstRef.current) {
          const snapshot = response.result.blobUrl && !response.result.content
            ? fetch(response.result.blobUrl)
                .then((r) => r.json())
                .then((geojson) => ({ ...response.result, content: geojson, blobUrl: undefined }))
                .catch(() => response.result)
            : Promise.resolve(response.result);

          void snapshot.then((snap) => {
            setResult(snap);
            const entry: HistoryEntry = {
              id: nanoid(),
              fileName: lastFileNameRef.current,
              command: lastCommandRef.current,
              ast: lastAstRef.current!,
              resultSnapshot: snap,
              timestamp: Date.now(),
            };
            setHistory((prev) => {
              const truncated = prev.entries.slice(0, prev.currentIndex + 1);
              return {
                entries: [...truncated, entry],
                currentIndex: truncated.length,
              };
            });
            void saveSession({
              id: entry.id,
              fileName: entry.fileName,
              command: entry.command,
              ast: entry.ast,
              resultSnapshot: snap,
              timestamp: entry.timestamp,
            });
          });
        } else {
          setResult(response.result);
        }
        return;
      }

      if (response.type === 'LAYER_SELECTED') {
        setMetadata(response.metadata);
        setStatus('ready');
        return;
      }

      if (response.type === 'ERROR') {
        setError(response.error);
        setStatus(response.error.code === 'TASK_CANCELLED' ? 'cancelled' : 'failed');
        if (response.error.code !== 'TASK_CANCELLED') {
          Sentry.captureException(new Error(response.error.message), { tags: { code: response.error.code } });
        }
      }
    };

    worker.onerror = (event) => {
      const error = {
        code: 'WORKER_RUNTIME_ERROR',
        message: event.message ?? 'WORKER_RUNTIME_ERROR',
        recoverable: false,
      };
      setError(error);
      setStatus('failed');
      Sentry.captureException(new Error(error.message), { tags: { code: error.code } });
    };

    worker.onmessageerror = () => {
      setError({
        code: 'WORKER_MESSAGE_ERROR',
        message: 'WORKER_MESSAGE_ERROR',
        recoverable: false,
      });
      setStatus('failed');
    };

    return worker;
  }, []);

  useEffect(() => {
    setupWorker();
    return () => workerRef.current?.terminate();
  }, [setupWorker]);

  const post = useCallback((request: WorkerRequest, transfer?: Transferable[]) => {
    workerRef.current?.postMessage(request, transfer ?? []);
  }, []);

  const uploadFile = useCallback(async (file: File) => {
    const taskId = nanoid();
    taskIdRef.current = taskId;
    fileRef.current = file;
    setStatus('uploading');
    setMetadata(null);
    setProgress([]);
    setError(null);
    setResult(null);
    setUndo(null);
    setHistory({ entries: [], currentIndex: -1 });
    lastAstRef.current = null;
    lastCommandRef.current = '';
    lastFileNameRef.current = file.name;

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

  const executeAst = useCallback((ast: GeoSurgicalAst, command?: string) => {
    const taskId = taskIdRef.current;
    if (!taskId) return;

    setStatus('executing');
    setError(null);
    setResult(null);
    setUndo(null);
    setProgress([]);
    lastAstRef.current = ast;
    lastCommandRef.current = command ?? '';
    post({ type: 'EXECUTE_AST', taskId, ast });
  }, [post]);

  const cancelTask = useCallback(() => {
    const currentFile = fileRef.current;

    // Terminate the worker to immediately stop WASM execution
    workerRef.current?.terminate();
    workerRef.current = null;

    setStatus('cancelled');
    setProgress([]);
    setError(null);
    lastAstRef.current = null;

    // Rebuild worker for future use
    setupWorker();

    // Re-upload the file to the new worker so metadata is available
    if (currentFile) {
      const reupload = async () => {
        const taskId = nanoid();
        taskIdRef.current = taskId;
        const buffer = await currentFile.arrayBuffer();
        setStatus('metadata-extracting');
        post(
          {
            type: 'UPLOAD_FILE',
            taskId,
            fileName: currentFile.name,
            fileSize: currentFile.size,
            buffer,
          },
          [buffer],
        );
      };
      void reupload();
    }
  }, [post, setupWorker]);

  const selectLayer = useCallback((layerName: string) => {
    const taskId = taskIdRef.current;
    if (!taskId) return;

    post({ type: 'SELECT_LAYER', taskId, layerName });
  }, [post]);

  const undoHistory = useCallback(() => {
    setHistory((prev) => {
      if (prev.currentIndex <= 0) return prev;
      const newIndex = prev.currentIndex - 1;
      const entry = prev.entries[newIndex];
      if (entry) {
        setResult(entry.resultSnapshot);
        setStatus('completed');
      }
      return { ...prev, currentIndex: newIndex };
    });
  }, []);

  const redoHistory = useCallback(() => {
    setHistory((prev) => {
      if (prev.currentIndex >= prev.entries.length - 1) return prev;
      const newIndex = prev.currentIndex + 1;
      const entry = prev.entries[newIndex];
      if (entry) {
        setResult(entry.resultSnapshot);
        setStatus('completed');
      }
      return { ...prev, currentIndex: newIndex };
    });
  }, []);

  const jumpToHistory = useCallback((index: number) => {
    setHistory((prev) => {
      if (index < 0 || index >= prev.entries.length) return prev;
      const entry = prev.entries[index];
      if (entry) {
        setResult(entry.resultSnapshot);
        setStatus('completed');
      }
      return { ...prev, currentIndex: index };
    });
  }, []);

  // Keyboard shortcuts for undo/redo
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
        e.preventDefault();
        undoHistory();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'z' && e.shiftKey) {
        e.preventDefault();
        redoHistory();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [undoHistory, redoHistory]);

  return useMemo(() => ({
    status,
    engineMode,
    wasmError,
    metadata,
    progress,
    error,
    result,
    setResult,
    undo,
    history,
    uploadFile,
    executeAst,
    cancelTask,
    selectLayer,
    undoHistory,
    redoHistory,
    jumpToHistory,
  }), [status, engineMode, wasmError, metadata, progress, error, result, setResult, undo, history, uploadFile, executeAst, cancelTask, selectLayer, undoHistory, redoHistory, jumpToHistory]);
}
