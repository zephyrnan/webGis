import { describe, expect, it } from 'vitest';
import { validateAst } from './astValidation';
import type { GeoSurgicalMetadata } from '../types/metadata';

const metadata: GeoSurgicalMetadata = {
  fileType: 'geojson',
  fileName: 'test.geojson',
  fileSize: 100,
  featureCountEstimate: 1,
  fields: [{ name: 'area', type: 'number' }, { name: 'name', type: 'string' }, { name: 'pop', type: 'number' }],
  bbox: null,
  crs: 'EPSG:4326',
  encoding: 'UTF-8',
  fieldPolicy: { totalFieldCount: 3, includedFieldCount: 3, truncated: false },
  warnings: [],
};

const metadataWithLayers: GeoSurgicalMetadata = {
  ...metadata,
  layers: [
    { name: 'parcels', featureCount: 100, fields: [], bbox: null, crs: 'EPSG:4326', encoding: 'UTF-8' },
    { name: 'roads', featureCount: 50, fields: [], bbox: null, crs: 'EPSG:4326', encoding: 'UTF-8' },
  ],
};

describe('validateAst', () => {
  // --- Schema validation ---
  it('rejects empty operations array', () => {
    const result = validateAst({ version: '1.0', operations: [] }, metadata);
    expect(result.ok).toBe(false);
  });

  it('rejects missing version', () => {
    const result = validateAst({ operations: [{ action: 'export', format: 'geojson' }] }, metadata);
    expect(result.ok).toBe(false);
  });

  it('rejects unknown action', () => {
    const result = validateAst({ version: '1.0', operations: [{ action: 'unknown_op' }] }, metadata);
    expect(result.ok).toBe(false);
  });

  // --- Per-operation valid cases ---
  it('accepts filter_area with valid field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'filter_area', field: 'area', operator: '>=', value: 10 }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.risk');
  });

  it('accepts filter_attribute with valid field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'filter_attribute', field: 'name', operator: '==', value: '承德市' }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.risk');
  });

  it('accepts drop_empty with valid field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'drop_empty', field: 'name' }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  it('accepts rename_field with valid fields', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'rename_field', from: 'name', to: 'label' }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  it('accepts transform_crs', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'transform_crs', from: 'EPSG:4326', to: 'GCJ-02' }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskTransform');
  });

  it('accepts fix_encoding', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'fix_encoding', from: 'gbk', to: 'utf-8' }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  it('accepts simplify', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'simplify', tolerance: 0.001 }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskSimplify');
  });

  it('accepts field_calculate', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'field_calculate', target_field: 'density', operation: 'divide', operands: ['pop', 'area'] }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskFieldCalc');
  });

  it('accepts validate_geometry', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'validate_geometry', mode: 'check_and_fix' }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskValidateGeometry');
  });

  it('accepts buffer', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'buffer', distance: 100 }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskBuffer');
  });

  it('accepts clip', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'clip', bbox: [113, 22, 114, 23] }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskClip');
  });

  it('accepts intersect', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'intersect', bbox: [113, 22, 114, 23] }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  it('accepts dissolve with valid field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'dissolve', field: 'name' }],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.riskDissolve');
  });

  it('accepts export', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'export', format: 'geojson' }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  it('accepts noop', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'noop', reason: 'unsupported' }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  it('accepts need_clarification', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'need_clarification', reason: 'specify layer' }],
    }, metadata);
    expect(result.ok).toBe(true);
  });

  // --- Field validation errors ---
  it('rejects filter_area with missing field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'filter_area', field: 'missing', operator: '>=', value: 0 }],
    }, metadata);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_IN_METADATA');
  });

  it('rejects drop_empty with missing field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'drop_empty', field: 'missing' }],
    }, metadata);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_IN_METADATA');
  });

  it('rejects rename_field with missing source field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'rename_field', from: 'missing', to: 'new' }],
    }, metadata);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_IN_METADATA');
  });

  it('rejects dissolve with missing field', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'dissolve', field: 'missing' }],
    }, metadata);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_IN_METADATA');
  });

  // --- Schema constraint errors ---
  it('rejects filter_area with invalid operator', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'filter_area', field: 'area', operator: '!=', value: 0 }],
    }, metadata);
    expect(result.ok).toBe(false);
  });

  it('rejects transform_crs with invalid target', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'transform_crs', from: 'EPSG:4326', to: 'EPSG:2154' }],
    }, metadata);
    expect(result.ok).toBe(false);
  });

  it('rejects simplify with negative tolerance', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'simplify', tolerance: -1 }],
    }, metadata);
    expect(result.ok).toBe(false);
  });

  it('rejects buffer with negative distance', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'buffer', distance: -100 }],
    }, metadata);
    expect(result.ok).toBe(false);
  });

  it('rejects fix_encoding with wrong target', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'fix_encoding', from: 'gbk', to: 'gbk' }],
    }, metadata);
    expect(result.ok).toBe(false);
  });

  // --- Layer validation ---
  it('accepts valid target_layer', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'export', format: 'geojson' }],
      target_layer: 'parcels',
    }, metadataWithLayers);
    expect(result.ok).toBe(true);
  });

  it('rejects unknown target_layer', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'export', format: 'geojson' }],
      target_layer: 'nonexistent',
    }, metadataWithLayers);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('LAYER_NOT_FOUND');
  });

  // --- Multi-operation pipeline ---
  it('accepts multi-step pipeline', () => {
    const result = validateAst({
      version: '1.0',
      operations: [
        { action: 'filter_area', field: 'area', operator: '>', value: 0 },
        { action: 'rename_field', from: 'name', to: 'label' },
        { action: 'export', format: 'geojson' },
      ],
    }, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.risks).toContain('ast.risk');
  });
});
