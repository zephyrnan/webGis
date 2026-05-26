import { createMockGeoSurgicalWasm } from '../wasm/geosurgicalMock';
import { decodeSurgeryEnvelope } from '../wasm/geosurgicalWasm';
import type { GeoSurgicalWasm } from '../wasm/geosurgicalWasm';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { WorkerRequest, WorkerResponse } from '../types/protocol';

let wasm: GeoSurgicalWasm;
let wasmMode: 'real' | 'mock' = 'mock';
const workerCacheVersion = 'docker-desktop-cache-reset-2026-05-21';

const taskContexts = new Map<string, {
  taskId: string;
  fileName: string;
  fileSize: number;
  buffer: ArrayBuffer;
  metadata?: GeoSurgicalMetadata;
  cancelled: boolean;
}>();

let wasmLoadError: string | undefined;

const wasmReady = (async () => {
  console.debug(`GeoSurgical worker ${workerCacheVersion}`);
  try {
    const { createRealGeoSurgicalWasm } = await import('../wasm/geosurgicalRealWasm');
    wasm = createRealGeoSurgicalWasm();
    wasmMode = 'real';
  } catch (err) {
    wasmLoadError = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
    wasm = createMockGeoSurgicalWasm();
    wasmMode = 'mock';
  }
  post({ type: 'ENGINE_STATUS', mode: wasmMode, wasmError: wasmLoadError });
})();

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const request = event.data;

  try {
    await wasmReady;

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
        progress: { phase: 'executing', message: '任务已取消。', messageKey: 'progress.cancelled', percent: 0 },
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
      return;
    }

    if (request.type === 'SELECT_LAYER') {
      const context = requireContext(request.taskId);
      const layers = context.metadata?.layers;
      if (!layers) {
        throw new Error('NO_LAYERS_AVAILABLE');
      }
      const layer = layers.find((l) => l.name === request.layerName);
      if (!layer) {
        throw new Error('LAYER_NOT_FOUND');
      }
      // Update context metadata with selected layer's data
      const updated: GeoSurgicalMetadata = {
        ...context.metadata!,
        fields: layer.fields,
        featureCountEstimate: layer.featureCount,
        bbox: layer.bbox,
        crs: layer.crs ?? context.metadata!.crs,
        encoding: layer.encoding,
      };
      context.metadata = updated;
      post({ type: 'LAYER_SELECTED', taskId: request.taskId, metadata: updated });
      return;
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
  // Clean up old task contexts to free ArrayBuffer memory
  for (const key of taskContexts.keys()) {
    if (key !== request.taskId) taskContexts.delete(key);
  }

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
    progress: {
      phase: 'metadata',
      message: wasmMode === 'real'
        ? 'Worker 已接管文件 buffer，Rust WASM 开始元数据分诊。'
        : 'Worker 已接管文件 buffer，开始元数据分诊（Mock 模式）。',
      messageKey: 'progress.metadataStart',
      percent: 15,
    },
  });

  const context = requireContext(request.taskId);
  const metadataJson = await wasm.extract_metadata(new Uint8Array(context.buffer), {
    fileName: context.fileName,
    fileSize: context.fileSize,
  });
  const metadata = JSON.parse(metadataJson) as GeoSurgicalMetadata;
  context.metadata = metadata;

  // Inject mode warning for mock
  if (wasmMode === 'mock') {
    metadata.warnings.push({
      code: 'WASM_MOCK_MODE',
      message: wasmLoadError
        ? `WASM_LOAD_FAILED: ${wasmLoadError}`
        : 'WASM_MOCK_MODE',
      recoverable: true,
    });
  }

  post({
    type: 'PROGRESS',
    taskId: request.taskId,
    progress: { phase: 'metadata', message: 'Metadata Dry Run 完成。', messageKey: 'progress.metadataDone', percent: 100 },
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
    progress: {
      phase: 'executing',
      message: wasmMode === 'real'
        ? 'Rust WASM 开始执行 GeoSurgical AST。'
        : '开始执行 GeoSurgical AST（Mock 模式）。',
      messageKey: 'progress.executeStart',
      percent: 10,
    },
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
        messageKey: 'progress.executingOperation',
        params: { operation: request.ast.operations[index].action },
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

  // 检测是否为二进制混合协议：[4字节头长 LE] + [Envelope JSON] + [GeoJSON bytes]
  // Mock 模式返回的是纯 JSON envelope，走 fallback
  let result: import('../types/protocol').SurgeryResult;
  let undo: import('../types/protocol').UndoCapability;

  if (bytes.byteLength > 4) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    const headerLen = view.getUint32(0, true); // Little Endian，与 Rust to_le_bytes() 对齐

    if (headerLen > 0 && headerLen < bytes.byteLength - 4) {
      // 二进制协议：切割头部和 payload
      const headerBytes = new Uint8Array(bytes.buffer, bytes.byteOffset + 4, headerLen);
      const payloadBytes = bytes.slice(4 + headerLen);

      const envelopeText = new TextDecoder().decode(headerBytes);
      const envelope = JSON.parse(envelopeText);

      const blob = new Blob([payloadBytes], { type: 'application/geo+json' });
      const blobUrl = URL.createObjectURL(blob);

      result = { ...envelope.result, blobUrl };
      undo = envelope.undo;
    } else {
      // Fallback: Mock 模式返回的纯 JSON envelope
      const envelope = decodeSurgeryEnvelope(bytes);
      result = envelope.result;
      undo = envelope.undo;
    }
  } else {
    const envelope = decodeSurgeryEnvelope(bytes);
    result = envelope.result;
    undo = envelope.undo;
  }

  post({
    type: 'PROGRESS',
    taskId: request.taskId,
    progress: { phase: 'exporting', message: '结果已生成，准备回传主线程。', messageKey: 'progress.exportReady', percent: 100 },
  });
  post({ type: 'RESULT_READY', taskId: request.taskId, result, undo });
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
  const message = error instanceof Error ? error.message : 'UNKNOWN_WORKER_ERROR';

  const knownErrors: Record<string, { recoverable: boolean }> = {
    TASK_CANCELLED: { recoverable: true },
    METADATA_NOT_READY: { recoverable: true },
    TASK_NOT_FOUND: { recoverable: true },
    LAYER_NOT_FOUND: { recoverable: true },
    NO_LAYERS_AVAILABLE: { recoverable: true },
  };

  const known = knownErrors[message];
  if (known) {
    return { code: message, message, recoverable: known.recoverable };
  }

  return {
    code: 'WORKER_ERROR',
    message,
    recoverable: false,
  };
}

export {};
