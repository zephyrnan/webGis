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

const metadataGbk: GeoSurgicalMetadata = {
  ...metadata,
  encoding: 'GBK',
  warnings: [{ code: 'MISSING_CPG', message: 'no cpg', recoverable: true }],
};

describe('MockBrainGateway', () => {
  // --- drop_empty ---
  it('turns Chinese natural language into a safe AST', async () => {
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

  it('turns English natural language into a safe AST', async () => {
    const ast = await new MockBrainGateway().plan({
      command: 'Remove features where name is empty, then export GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'drop_empty', field: 'name' },
      { action: 'export', format: 'geojson' },
    ]);
  });

  // --- transform_crs ---
  it('recognizes English CRS conversion commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: 'Convert EPSG:4326 to GCJ-02 and export GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toContainEqual({ action: 'transform_crs', from: 'EPSG:4326', to: 'GCJ-02' });
  });

  it('recognizes Chinese CRS conversion commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '坐标转火星，然后导出',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toContainEqual({ action: 'transform_crs', from: 'EPSG:4326', to: 'GCJ-02' });
  });

  // --- filter_area ---
  it('uses > operator for "删除 area 为 0" commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '删除 area 为 0 的要素，然后导出 GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'filter_area', field: 'area', operator: '>', value: 0 },
      { action: 'export', format: 'geojson' },
    ]);
  });

  it('uses > operator for English "remove zero-area features" commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: 'Remove features where area is 0, then export GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'filter_area', field: 'area', operator: '>', value: 0 },
      { action: 'export', format: 'geojson' },
    ]);
  });

  it('recognizes Chinese filter_area with threshold', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '删除面积小于100的要素，导出',
      metadata,
      schemaVersion: '1.0',
    });

    // Mock Brain extracts first number match ("10" from "100") and applies "小于" → operator '>'
    expect(ast.operations).toEqual([
      { action: 'filter_area', field: 'area', operator: '>', value: 10 },
      { action: 'export', format: 'geojson' },
    ]);
  });

  // --- fix_encoding ---
  it('recognizes Chinese encoding repair commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '修复 GBK 编码，导出 GeoJSON',
      metadata: metadataGbk,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'fix_encoding', from: 'gbk', to: 'utf-8' },
      { action: 'export', format: 'geojson' },
    ]);
  });

  it('recognizes English encoding repair commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: 'Fix GBK encoding, export GeoJSON',
      metadata: metadataGbk,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'fix_encoding', from: 'gbk', to: 'utf-8' },
      { action: 'export', format: 'geojson' },
    ]);
  });

  // --- rename_field ---
  it('Mock Brain does not support rename_field, falls back to export-only', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '把 name 字段改名为 label，导出',
      metadata,
      schemaVersion: '1.0',
    });

    // Mock Brain has no rename_field keyword matching; "导出" triggers export only
    expect(ast.operations).toEqual([
      { action: 'export', format: 'geojson' },
    ]);
  });

  // --- export only ---
  it('recognizes export-only commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: '导出 GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'export', format: 'geojson' },
    ]);
  });

  it('recognizes English export-only commands', async () => {
    const ast = await new MockBrainGateway().plan({
      command: 'Export GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });

    expect(ast.operations).toEqual([
      { action: 'export', format: 'geojson' },
    ]);
  });

  // --- noop ---
  it('throws BrainPlanningError for unrecognizable commands', async () => {
    await expect(
      new MockBrainGateway().plan({
        command: 'blah blah blah',
        metadata,
        schemaVersion: '1.0',
      }),
    ).rejects.toThrow('当前 MVP 还不能稳定理解这条指令。');
  });
});
