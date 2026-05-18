import type { GeoSurgicalAst } from './ast';
import type { GeoSurgicalMetadata } from './metadata';

export type TaskId = string;

export type ProgressPhase = 'metadata' | 'planning' | 'validating' | 'executing' | 'exporting';

export type ProgressEvent = {
  phase: ProgressPhase;
  message: string;
  messageKey?: string;
  params?: Record<string, string | number>;
  percent?: number;
  operationIndex?: number;
};

export type StructuredError = {
  code: string;
  message: string;
  recoverable: boolean;
  suggestedUserInput?: string;
  details?: unknown;
};

export type UndoCapability = {
  available: boolean;
  reason?: 'file_too_large' | 'operation_irreversible' | 'no_previous_snapshot' | 'mock_mode';
  strategy: 'snapshot' | 'replay_from_original' | 'disabled';
};

export type SurgeryResult = {
  kind: 'geojson' | 'summary';
  fileName: string;
  content?: GeoJSON.FeatureCollection;
  summary: {
    inputFeatureCount: number | null;
    outputFeatureCount: number | null;
    operations: string[];
    mockMode: boolean;
  };
  logs: string[];
  warnings: string[];
};

export type WorkerRequest =
  | {
      type: 'UPLOAD_FILE';
      taskId: TaskId;
      fileName: string;
      fileSize: number;
      buffer: ArrayBuffer;
    }
  | {
      type: 'EXECUTE_AST';
      taskId: TaskId;
      ast: GeoSurgicalAst;
    }
  | {
      type: 'CANCEL_TASK';
      taskId: TaskId;
    }
  | {
      type: 'SEARCH_FIELDS';
      taskId: TaskId;
      query: string;
    }
  | {
      type: 'SELECT_LAYER';
      taskId: TaskId;
      layerName: string;
    };

export type WorkerResponse =
  | {
      type: 'METADATA_READY';
      taskId: TaskId;
      metadata: GeoSurgicalMetadata;
    }
  | {
      type: 'PROGRESS';
      taskId: TaskId;
      progress: ProgressEvent;
    }
  | {
      type: 'RESULT_READY';
      taskId: TaskId;
      result: SurgeryResult;
      undo: UndoCapability;
    }
  | {
      type: 'FIELDS_FOUND';
      taskId: TaskId;
      fields: GeoSurgicalMetadata['fields'];
    }
  | {
      type: 'LAYER_SELECTED';
      taskId: TaskId;
      metadata: GeoSurgicalMetadata;
    }
  | {
      type: 'ERROR';
      taskId: TaskId;
      error: StructuredError;
    }
  | {
      type: 'ENGINE_STATUS';
      mode: 'real' | 'mock';
      wasmError?: string;
    };
