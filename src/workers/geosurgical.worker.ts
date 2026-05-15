import { createMockGeoSurgicalWasm } from '../wasm/geosurgicalMock';
import { decodeSurgeryEnvelope } from '../wasm/geosurgicalWasm';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { WorkerRequest, WorkerResponse } from '../types/protocol';

const wasm = createMockGeoSurgicalWasm();

const taskContexts = new Map<string, {
  taskId: string;
  fileName: string;
  fileSize: number;
  buffer: ArrayBuffer;
  metadata?: GeoSurgicalMetadata;
  cancelled: boolean;
}>();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    if (request.type === 'UPLOAD_FILE') {
      await handleUpload(request);
      return;
    }

    if (request.type === 'EXECUTE_AST') {
      await handleExecute(request);
      return;
    }

    if (request.type === 'CANCEL_TASK') {
      const context = taskContexts.get(request.taskId);
      if (context) context.cancelled = true;
      post({
        type: 'PROGRESS',
        taskId: request.taskId,
        progress: { phase: 'executing', message: '任务已取消。', percent: 0 },
      });
      return;
    }

    if (request.type === 'SEARCH_FIELDS') {
      const context = requireContext(request.taskId);
      const query = request.query.toLowerCase();
      post({
        type: 'FIELDS_FOUND',
        taskId: request.taskId,
        fields: (context.metadata?.fields ?? []).filter((field) => field.name.toLowerCase().includes(query)),
      });
    }
  } catch (error) {
    post({
      type: 'ERROR',
      taskId: request.taskId,
      error: toStructuredError(error),
    });
  }
};

async function handleUpload(request: Extract<WorkerRequest, { type: 'UPLOAD_FILE' }>) {
  taskContexts.set(request.taskId, {
    taskId: request.taskId,
    fileName: request.fileName,
    fileSize: request.fileSize,
    buffer: request.buffer,
    cancelled: false,
  });

  post({
    type: 'PROGRESS',
    taskId: request.taskId,
    progress: { phase: 'metadata', message: 'Worker 已接管文件 buffer，开始元数据分诊。', percent: 15 },
  });

  const context = requireContext(request.taskId);
  const metadataJson = await wasm.extract_metadata(new Uint8Array(context.buffer), {
    fileName: context.fileName,
    fileSize: context.fileSize,
  });
  const metadata = JSON.parse(metadataJson) as GeoSurgicalMetadata;
  context.metadata = metadata;

  post({
    type: 'PROGRESS',
    taskId: request.taskId,
    progress: { phase: 'metadata', message: 'Metadata Dry Run 完成。', percent: 100 },
  });
  post({ type: 'METADATA_READY', taskId: request.taskId, metadata });
}

async function handleExecute(request: Extract<WorkerRequest, { type: 'EXECUTE_AST' }>) {
  const context = requireContext(request.taskId);

  if (!context.metadata) {
    throw new Error('METADATA_NOT_READY');
  }

  post({
    type: 'PROGRESS',
    taskId: request.taskId,
    progress: { phase: 'executing', message: '开始执行 GeoSurgical AST。', percent: 10 },
  });

  for (let index = 0; index < request.ast.operations.length; index += 1) {
    if (context.cancelled) {
      throw new Error('TASK_CANCELLED');
    }

    post({
      type: 'PROGRESS',
      taskId: request.taskId,
      progress: {
        phase: 'executing',
        message: `正在执行 ${request.ast.operations[index].action}`,
        percent: Math.round(20 + (index / request.ast.operations.length) * 60),
        operationIndex: index,
      },
    });
  }

  const bytes = await wasm.execute_surgery(new Uint8Array(context.buffer), JSON.stringify(request.ast), {
    fileName: context.fileName,
    fileSize: context.fileSize,
    metadata: context.metadata,
  });
  const envelope = decodeSurgeryEnvelope(bytes);

  post({
    type: 'PROGRESS',
    taskId: request.taskId,
    progress: { phase: 'exporting', message: '结果已生成，准备回传主线程。', percent: 100 },
  });
  post({ type: 'RESULT_READY', taskId: request.taskId, result: envelope.result, undo: envelope.undo });
}

function requireContext(taskId: string) {
  const context = taskContexts.get(taskId);

  if (!context) {
    throw new Error('TASK_NOT_FOUND');
  }

  return context;
}

function post(response: WorkerResponse) {
  self.postMessage(response);
}

function toStructuredError(error: unknown) {
  const message = error instanceof Error ? error.message : '未知 Worker 错误。';

  if (message === 'TASK_CANCELLED') {
    return { code: 'TASK_CANCELLED', message: '任务已取消。', recoverable: true };
  }

  if (message === 'METADATA_NOT_READY') {
    return { code: 'METADATA_NOT_READY', message: '请等待 Metadata 分诊完成后再执行。', recoverable: true };
  }

  if (message === 'TASK_NOT_FOUND') {
    return { code: 'TASK_NOT_FOUND', message: '未找到任务上下文，请重新上传文件。', recoverable: true };
  }

  return {
    code: 'WORKER_ERROR',
    message,
    recoverable: false,
  };
}

export {};
