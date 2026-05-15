import { describe, expect, it } from 'vitest';
import { MockBrainGateway } from './brain';
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

describe('MockBrainGateway', () => {
  it('turns natural language into a safe AST', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '删除 name 为空的要素，然后导出 GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'drop_empty', field: 'name' },
      { action: 'export', format: 'geojson' },
    ]);
  });
});
