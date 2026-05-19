// AST 单一事实来源：schemas/ast-schema.json
// 新增 action 时必须同步更新：schema、本文件、astValidation.ts (Zod)、llmBrain.ts (prompt)、src-wasm/src/types.rs (Rust)
export type GeoOperationAction =
  | 'filter_area'
  | 'drop_empty'
  | 'transform_crs'
  | 'fix_encoding'
  | 'rename_field'
  | 'simplify'
  | 'field_calculate'
  | 'validate_geometry'
  | 'buffer'
  | 'clip'
  | 'intersect'
  | 'dissolve'
  | 'export'
  | 'noop'
  | 'need_clarification';

export type FilterAreaOperation = {
  action: 'filter_area';
  field: string;
  operator: '>=' | '>' | '<=' | '<' | '=';
  value: number;
};

export type DropEmptyOperation = {
  action: 'drop_empty';
  field: string;
};

export type TransformCrsOperation = {
  action: 'transform_crs';
  from: string;
  to: 'GCJ-02' | 'EPSG:4326' | 'EPSG:3857';
};

export type FixEncodingOperation = {
  action: 'fix_encoding';
  from: string;
  to: 'utf-8';
};

export type RenameFieldOperation = {
  action: 'rename_field';
  from: string;
  to: string;
};

export type SimplifyOperation = {
  action: 'simplify';
  tolerance: number;
  preserve_topology?: boolean;
};

export type FieldCalculateOperation = {
  action: 'field_calculate';
  target_field: string;
  operation: 'add' | 'subtract' | 'multiply' | 'divide';
  operands: [string, string];
};

export type ValidateGeometryOperation = {
  action: 'validate_geometry';
  mode: 'check' | 'check_and_fix';
};

export type BufferOperation = {
  action: 'buffer';
  distance: number;
  segments?: number;
};

export type ClipOperation = {
  action: 'clip';
  bbox: [number, number, number, number];
};

export type IntersectOperation = {
  action: 'intersect';
  bbox: [number, number, number, number];
};

export type DissolveOperation = {
  action: 'dissolve';
  field: string;
};

export type ExportOperation = {
  action: 'export';
  format: 'geojson';
};

export type NoopOperation = {
  action: 'noop';
  reason: string;
};

export type NeedClarificationOperation = {
  action: 'need_clarification';
  reason: string;
};

export type GeoSurgicalOperation =
  | FilterAreaOperation
  | DropEmptyOperation
  | TransformCrsOperation
  | FixEncodingOperation
  | RenameFieldOperation
  | SimplifyOperation
  | FieldCalculateOperation
  | ValidateGeometryOperation
  | BufferOperation
  | ClipOperation
  | IntersectOperation
  | DissolveOperation
  | ExportOperation
  | NoopOperation
  | NeedClarificationOperation;

export type GeoSurgicalAst = {
  version: '1.0';
  operations: GeoSurgicalOperation[];
  target_layer?: string;
};
