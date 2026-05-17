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
        message: formatZodIssue(parsed.error.issues[0]) ?? 'AST 格式不正确。',
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

    if (operation.action === 'drop_empty' || operation.action === 'filter_area') {
      risks.push('ast.risk');
    }

    if (operation.action === 'transform_crs') {
      risks.push('ast.riskTransform');
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
          message: `图层 ${parsed.data.target_layer} 不在当前文件的图层目录中。`,
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
      message: `字段 ${field} 不在当前 Metadata 摘要中。`,
      recoverable: true,
      suggestedUserInput: '请确认字段名，或先搜索字段。',
    },
  };
}
