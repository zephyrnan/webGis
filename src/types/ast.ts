export type GeoOperationAction =
  | 'filter_area'
  | 'drop_empty'
  | 'transform_crs'
  | 'fix_encoding'
  | 'rename_field'
  | 'export'
  | 'noop';

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

export type ExportOperation = {
  action: 'export';
  format: 'geojson';
};

export type NoopOperation = {
  action: 'noop';
  reason: string;
};

export type GeoSurgicalOperation =
  | FilterAreaOperation
  | DropEmptyOperation
  | TransformCrsOperation
  | FixEncodingOperation
  | RenameFieldOperation
  | ExportOperation
  | NoopOperation;

export type GeoSurgicalAst = {
  version: '1.0';
  operations: GeoSurgicalOperation[];
};
