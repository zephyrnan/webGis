// Zod schema — auto-generated from schemas/ast-schema.json via `npm run generate:zod`
import { z } from 'zod';
import type { GeoSurgicalAst, GeoSurgicalOperation } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { StructuredError } from '../types/protocol';
import { astSchema } from './astValidation.generated';

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
