// AST types — derived from schemas/ast-schema.json via `npm run generate:types`
// This file re-exports generated types with names used throughout the codebase.
import type {
  GeoSurgicalAST,
  Operation,
  FilterArea,
  DropEmpty,
  TransformCrs,
  FixEncoding,
  RenameField,
  Simplify,
  FieldCalculate,
  ValidateGeometry,
  Buffer,
  Clip,
  Intersect,
  Dissolve,
  Export,
  Noop,
  NeedClarification,
} from './ast.generated';

export type GeoSurgicalAst = GeoSurgicalAST;
export type GeoSurgicalOperation = Operation;
export type FilterAreaOperation = FilterArea;
export type DropEmptyOperation = DropEmpty;
export type TransformCrsOperation = TransformCrs;
export type FixEncodingOperation = FixEncoding;
export type RenameFieldOperation = RenameField;
export type SimplifyOperation = Simplify;
export type FieldCalculateOperation = FieldCalculate;
export type ValidateGeometryOperation = ValidateGeometry;
export type BufferOperation = Buffer;
export type ClipOperation = Clip;
export type IntersectOperation = Intersect;
export type DissolveOperation = Dissolve;
export type ExportOperation = Export;
export type NoopOperation = Noop;
export type NeedClarificationOperation = NeedClarification;

export type GeoOperationAction = Operation['action'];
