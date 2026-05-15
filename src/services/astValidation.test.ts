import { describe, expect, it } from 'vitest';
import { validateAst } from './astValidation';
import type { GeoSurgicalMetadata } from '../types/metadata';

const metadata: GeoSurgicalMetadata = {
  fileType: 'geojson',
  fileName: 'test.geojson',
  fileSize: 100,
  featureCountEstimate: 1,
  fields: [{ name: 'area', type: 'number' }, { name: 'name', type: 'string' }],
  bbox: null,
  crs: 'EPSG:4326',
  encoding: 'UTF-8',
  fieldPolicy: { totalFieldCount: 2, includedFieldCount: 2, truncated: false },
  warnings: [],
};

describe('validateAst', () => {
  it('accepts whitelisted operations with existing fields', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'drop_empty', field: 'name' }, { action: 'export', format: 'geojson' }],
    }, metadata);

    expect(result.ok).toBe(true);
  });

  it('rejects missing metadata fields', () => {
    const result = validateAst({
      version: '1.0',
      operations: [{ action: 'drop_empty', field: 'missing' }],
    }, metadata);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.code).toBe('FIELD_NOT_IN_METADATA');
  });
});
