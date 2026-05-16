import type { GeoSurgicalAst, GeoSurgicalOperation } from '../types/ast';
import type { GeoField, GeoFieldType, GeoSurgicalMetadata } from '../types/metadata';
import { getFileExtension } from '../services/fileGuards';
import { sampleGeojson } from '../test/sampleGeojson';
import type { GeoSurgicalWasm, MetadataInputContext, ExecuteInputContext } from './geosurgicalWasm';
import { encodeSurgeryEnvelope, parseAst } from './geosurgicalWasm';

export function createMockGeoSurgicalWasm(): GeoSurgicalWasm {
  return {
    extract_metadata(input, context) {
      const extension = getFileExtension(context.fileName);

      if (extension === '.geojson' || extension === '.json') {
        return JSON.stringify(extractGeoJsonMetadata(input, context));
      }

      return JSON.stringify(createBinaryMockMetadata(context, extension));
    },

    execute_surgery(input, jsonInstructions, context) {
      const ast = parseAst(jsonInstructions);
      const extension = getFileExtension(context.fileName);

      if (extension === '.geojson' || extension === '.json') {
        const collection = parseGeoJson(input) ?? sampleGeojson;
        const output = applyOperations(collection, ast);
        const envelope = {
          result: {
            kind: 'geojson' as const,
            fileName: toOutputFileName(context.fileName),
            content: output,
            summary: {
              inputFeatureCount: collection.features.length,
              outputFeatureCount: output.features.length,
              operations: ast.operations.map((operation) => operation.action),
              mockMode: true,
            },
            logs: ast.operations.map((operation) => `operation:${operation.action}`),
            warnings: ['WASM_MOCK_MODE'],
          },
          undo: {
            available: context.fileSize <= 50 * 1024 * 1024,
            reason: context.fileSize > 50 * 1024 * 1024 ? 'file_too_large' as const : undefined,
            strategy: context.fileSize <= 50 * 1024 * 1024 ? 'snapshot' as const : 'replay_from_original' as const,
          },
        };

        return encodeSurgeryEnvelope(envelope);
      }

      return encodeSurgeryEnvelope({
        result: {
          kind: 'summary',
          fileName: toOutputFileName(context.fileName),
          summary: {
            inputFeatureCount: context.metadata.featureCountEstimate,
            outputFeatureCount: null,
            operations: ast.operations.map((operation) => operation.action),
            mockMode: true,
          },
          logs: ['summary:shapefile_mock'],
          warnings: ['SHAPEFILE_MOCK_MODE'],
        },
        undo: {
          available: false,
          reason: 'mock_mode',
          strategy: 'disabled',
        },
      });
    },
  };
}

function extractGeoJsonMetadata(input: Uint8Array, context: MetadataInputContext): GeoSurgicalMetadata {
  const collection = parseGeoJson(input) ?? sampleGeojson;
  const fields = collectFields(collection).slice(0, 50);
  const totalFieldCount = collectFields(collection).length;

  return {
    fileType: 'geojson',
    fileName: context.fileName,
    fileSize: context.fileSize,
    featureCountEstimate: collection.features.length,
    fields,
    bbox: calculateBbox(collection),
    crs: detectCrs(collection),
    encoding: 'UTF-8',
    fieldPolicy: {
      totalFieldCount,
      includedFieldCount: fields.length,
      truncated: totalFieldCount > fields.length,
    },
    warnings: [
      {
        code: 'WASM_MOCK_MODE',
        message: '当前使用 TypeScript Mock WASM 提取元数据，真实 Rust WASM 尚未接入。',
        recoverable: true,
      },
    ],
  };
}

function createBinaryMockMetadata(context: MetadataInputContext, extension: string): GeoSurgicalMetadata {
  return {
    fileType: extension === '.zip' ? 'shapefile_zip' : extension === '.shp' ? 'shapefile' : 'unknown',
    fileName: context.fileName,
    fileSize: context.fileSize,
    featureCountEstimate: null,
    fields: [],
    bbox: null,
    crs: null,
    encoding: null,
    fieldPolicy: {
      totalFieldCount: 0,
      includedFieldCount: 0,
      truncated: false,
    },
    warnings: [
      {
        code: 'WASM_MOCK_MODE',
        message: 'MVP 阶段不在 JS 主线程解析 zip/shp；真实解析会在 Rust WASM 接入后完成。',
        recoverable: true,
      },
      {
        code: 'CRS_UNKNOWN',
        message: '当前 mock 无法读取投影信息，请用自然语言补充原始坐标系。',
        recoverable: true,
        suggestedUserInput: '这个文件的原始坐标系是 EPSG:4326。',
      },
    ],
  };
}

function parseGeoJson(input: Uint8Array): GeoJSON.FeatureCollection | null {
  try {
    const parsed = JSON.parse(new TextDecoder().decode(input)) as GeoJSON.GeoJSON;

    if (parsed.type === 'FeatureCollection') {
      return parsed;
    }

    if (parsed.type === 'Feature') {
      return { type: 'FeatureCollection', features: [parsed] };
    }
  } catch {
    return null;
  }

  return null;
}

function collectFields(collection: GeoJSON.FeatureCollection): GeoField[] {
  const values = new Map<string, Array<string | number | boolean | null>>();
  const nullCounts = new Map<string, number>();

  for (const feature of collection.features) {
    const properties = feature.properties ?? {};

    for (const [key, value] of Object.entries(properties)) {
      if (!values.has(key)) values.set(key, []);
      if (value == null || value === '') nullCounts.set(key, (nullCounts.get(key) ?? 0) + 1);

      const samples = values.get(key)!;
      if (samples.length < 3 && isSampleValue(value)) {
        samples.push(value);
      }
    }
  }

  return [...values.entries()].map(([name, sample]) => ({
    name,
    type: inferFieldType(sample),
    sample,
    nullRateEstimate: collection.features.length === 0 ? 0 : (nullCounts.get(name) ?? 0) / collection.features.length,
  }));
}

function inferFieldType(values: Array<string | number | boolean | null>): GeoFieldType {
  const firstValue = values.find((value) => value != null);
  if (typeof firstValue === 'number') return 'number';
  if (typeof firstValue === 'boolean') return 'boolean';
  if (typeof firstValue === 'string') return /^\d{4}-\d{2}-\d{2}/.test(firstValue) ? 'date' : 'string';
  return 'unknown';
}

function isSampleValue(value: unknown): value is string | number | boolean | null {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value);
}

function calculateBbox(collection: GeoJSON.FeatureCollection): [number, number, number, number] | null {
  const coordinates: number[][] = [];

  for (const feature of collection.features) {
    collectCoordinates(feature.geometry, coordinates);
  }

  if (coordinates.length === 0) return null;

  const xs = coordinates.map(([x]) => x);
  const ys = coordinates.map(([, y]) => y);

  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

function collectCoordinates(geometry: GeoJSON.Geometry | null, output: number[][]) {
  if (!geometry) return;

  const visit = (value: unknown) => {
    if (Array.isArray(value) && typeof value[0] === 'number' && typeof value[1] === 'number') {
      output.push(value as number[]);
      return;
    }

    if (Array.isArray(value)) value.forEach(visit);
  };

  if (geometry.type === 'GeometryCollection') {
    geometry.geometries.forEach((item) => collectCoordinates(item, output));
  } else {
    visit(geometry.coordinates);
  }
}

function detectCrs(collection: GeoJSON.FeatureCollection) {
  const bbox = calculateBbox(collection);
  if (!bbox) return null;

  const [minX, minY, maxX, maxY] = bbox;
  return minX >= -180 && maxX <= 180 && minY >= -90 && maxY <= 90 ? 'EPSG:4326' : null;
}

function applyOperations(collection: GeoJSON.FeatureCollection, ast: GeoSurgicalAst): GeoJSON.FeatureCollection {
  let features = [...collection.features];

  for (const operation of ast.operations) {
    features = applyOperation(features, operation);
  }

  return { ...collection, features };
}

function applyOperation(features: GeoJSON.Feature[], operation: GeoSurgicalOperation) {
  if (operation.action === 'drop_empty') {
    return features.filter((feature) => {
      const value = feature.properties?.[operation.field];
      return value != null && value !== '';
    });
  }

  if (operation.action === 'filter_area') {
    return features.filter((feature) => compareNumber(Number(feature.properties?.[operation.field] ?? 0), operation.operator, operation.value));
  }

  if (operation.action === 'rename_field') {
    return features.map((feature) => {
      const properties = { ...(feature.properties ?? {}) };
      properties[operation.to] = properties[operation.from];
      delete properties[operation.from];
      return { ...feature, properties };
    });
  }

  return features;
}

function compareNumber(left: number, operator: string, right: number) {
  if (operator === '>=') return left >= right;
  if (operator === '>') return left > right;
  if (operator === '<=') return left <= right;
  if (operator === '<') return left < right;
  return left === right;
}

function toOutputFileName(fileName: string) {
  const baseName = fileName.replace(/\.[^.]+$/, '');
  return `${baseName}.geosurgical.geojson`;
}
