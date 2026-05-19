// Zod schema 与 schemas/ast-schema.json 保持同步。新增 action 时同步更新此处和 schema 文件。
import { z } from 'zod';
import type { GeoSurgicalAst, GeoSurgicalOperation } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { StructuredError } from '../types/protocol';

const operationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('filter_area'),
    field: z.string().min(1),
    operator: z.enum(['>=', '>', '<=', '<', '=']),
    value: z.number().finite(),
  }),
  z.object({
    action: z.literal('drop_empty'),
    field: z.string().min(1),
  }),
  z.object({
    action: z.literal('transform_crs'),
    from: z.string().min(1),
    to: z.enum(['GCJ-02', 'EPSG:4326', 'EPSG:3857']),
  }),
  z.object({
    action: z.literal('fix_encoding'),
    from: z.string().min(1),
    to: z.literal('utf-8'),
  }),
  z.object({
    action: z.literal('simplify'),
    tolerance: z.number().finite().positive(),
    preserve_topology: z.boolean().optional(),
  }),
  z.object({
    action: z.literal('field_calculate'),
    target_field: z.string().min(1),
    operation: z.enum(['add', 'subtract', 'multiply', 'divide']),
    operands: z.tuple([z.string(), z.string()]),
  }),
  z.object({
    action: z.literal('validate_geometry'),
    mode: z.enum(['check', 'check_and_fix']),
  }),
  z.object({
    action: z.literal('buffer'),
    distance: z.number().finite().positive(),
    segments: z.number().int().positive().optional(),
  }),
  z.object({
    action: z.literal('clip'),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  z.object({
    action: z.literal('intersect'),
    bbox: z.tuple([z.number(), z.number(), z.number(), z.number()]),
  }),
  z.object({
    action: z.literal('dissolve'),
    field: z.string().min(1),
  }),
  z.object({
    action: z.literal('rename_field'),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    action: z.literal('export'),
    format: z.literal('geojson'),
  }),
  z.object({
    action: z.literal('noop'),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal('need_clarification'),
    reason: z.string().min(1),
  }),
]);

const astSchema = z.object({
  version: z.literal('1.0'),
  operations: z.array(operationSchema).min(1),
  target_layer: z.string().optional(),
});

export type ValidationResult =
  | { ok: true; ast: GeoSurgicalAst; risks: string[] }
  | { ok: false; error: StructuredError };

export function validateAst(ast: unknown, metadata: GeoSurgicalMetadata): ValidationResult {
  const parsed = astSchema.safeParse(ast);

  if (!parsed.success) {
    return {
      ok: false,
      error: {
        code: 'AST_SCHEMA_INVALID',
        message: formatZodIssue(parsed.error.issues[0]) ?? 'validation.invalidAstFormat',
        recoverable: true,
      },
    };
  }

  const fieldNames = new Set(metadata.fields.map((field) => field.name));
  const risks: string[] = [];

  for (const operation of parsed.data.operations as GeoSurgicalOperation[]) {
    if ('field' in operation && !fieldNames.has(operation.field)) {
      return missingField(operation.field);
    }

    if (operation.action === 'rename_field' && !fieldNames.has(operation.from)) {
      return missingField(operation.from);
    }

    if (operation.action === 'dissolve' && !fieldNames.has(operation.field)) {
      return missingField(operation.field);
    }

    if (operation.action === 'drop_empty' || operation.action === 'filter_area') {
      risks.push('ast.risk');
    }

    if (operation.action === 'transform_crs') {
      risks.push('ast.riskTransform');
    }

    if (operation.action === 'simplify') {
      risks.push('ast.riskSimplify');
    }

    if (operation.action === 'field_calculate') {
      risks.push('ast.riskFieldCalc');
    }

    if (operation.action === 'validate_geometry' && operation.mode === 'check_and_fix') {
      risks.push('ast.riskValidateGeometry');
    }

    if (operation.action === 'buffer') {
      risks.push('ast.riskBuffer');
    }

    if (operation.action === 'clip' || operation.action === 'intersect') {
      risks.push('ast.riskClip');
    }

    if (operation.action === 'dissolve') {
      risks.push('ast.riskDissolve');
    }
  }

  // Validate target_layer exists in metadata.layers
  if (parsed.data.target_layer && metadata.layers?.length) {
    const layerExists = metadata.layers.some((l) => l.name === parsed.data.target_layer);
    if (!layerExists) {
      return {
        ok: false,
        error: {
          code: 'LAYER_NOT_FOUND',
          message: `validation.layerNotInFile?layer=${parsed.data.target_layer}`,
          recoverable: true,
        },
      };
    }
  }

  return { ok: true, ast: parsed.data, risks };
}

function formatZodIssue(issue: z.core.$ZodIssue | undefined) {
  if (!issue) return null;

  const path = issue.path.length ? issue.path.join('.') : 'AST';
  return `${path}: ${issue.message}`;
}

function missingField(field: string): ValidationResult {
  return {
    ok: false,
    error: {
      code: 'FIELD_NOT_IN_METADATA',
      message: `validation.fieldNotInMetadata?field=${field}`,
      recoverable: true,
      suggestedUserInput: 'validation.confirmFieldName',
    },
  };
}
