import type { GeoSurgicalAst } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { StructuredError } from '../types/protocol';

export interface BrainGateway {
  plan(input: {
    command: string;
    metadata: GeoSurgicalMetadata;
    schemaVersion: '1.0';
  }): Promise<GeoSurgicalAst>;
}

export class BrainPlanningError extends Error {
  readonly structuredError: StructuredError;

  constructor(error: StructuredError) {
    super(error.message);
    this.structuredError = error;
  }
}

export class MockBrainGateway implements BrainGateway {
  async plan(input: {
    command: string;
    metadata: GeoSurgicalMetadata;
    schemaVersion: '1.0';
  }): Promise<GeoSurgicalAst> {
    const normalized = input.command.trim().toLowerCase();

    if (!normalized) {
      throw new BrainPlanningError({
        code: 'EMPTY_COMMAND',
        message: '请输入要执行的空间处理需求。',
        recoverable: true,
      });
    }

    const operations: GeoSurgicalAst['operations'] = [];
    const fieldNames = new Set(input.metadata.fields.map((field) => field.name.toLowerCase()));

    if (mentionsArea(normalized)) {
      assertField(fieldNames, 'area');
      operations.push({
        action: 'filter_area',
        field: 'area',
        operator: mentionsLessThan(normalized) ? '>' : '>=',
        value: normalized.includes('10') ? 10 : 0,
      });
    }

    if (mentionsEmptyName(normalized)) {
      assertField(fieldNames, 'name');
      operations.push({ action: 'drop_empty', field: 'name' });
    }

    if (mentionsCrsTransform(normalized)) {
      operations.push({
        action: 'transform_crs',
        from: input.metadata.crs ?? 'EPSG:4326',
        to: 'GCJ-02',
      });
    }

    if (mentionsExport(normalized) || operations.length > 0) {
      operations.push({ action: 'export', format: 'geojson' });
    }

    if (operations.length === 0) {
      throw new BrainPlanningError({
        code: 'COMMAND_NOT_UNDERSTOOD',
        message: '当前 MVP 还不能稳定理解这条指令。',
        recoverable: true,
        suggestedUserInput: '可以试试”删除 name 为空的要素，然后导出 GeoJSON”。',
      });
    }

    // Detect target layer from command
    let targetLayer: string | undefined;
    if (input.metadata.layers?.length) {
      for (const layer of input.metadata.layers) {
        if (normalized.includes(layer.name.toLowerCase())) {
          targetLayer = layer.name;
          break;
        }
      }
      // Default to the layer with the most features if not specified
      if (!targetLayer && input.metadata.layers.length > 1) {
        const sorted = [...input.metadata.layers].sort((a, b) => (b.featureCount ?? 0) - (a.featureCount ?? 0));
        targetLayer = sorted[0].name;
      }
    }

    return { version: input.schemaVersion, operations, target_layer: targetLayer };
  }
}

function mentionsArea(command: string) {
  return command.includes('area') || command.includes('面积');
}

function mentionsLessThan(command: string) {
  return command.includes('小于') || command.includes('<') || command.includes('less than') || command.includes('below');
}

function mentionsEmptyName(command: string) {
  return command.includes('name') && (
    command.includes('空')
    || command.includes('为空')
    || command.includes('empty')
    || command.includes('blank')
    || command.includes('null')
  );
}

function mentionsCrsTransform(command: string) {
  return command.includes('火星')
    || command.includes('gcj')
    || command.includes('mars coordinate')
    || command.includes('convert')
    || command.includes('transform');
}

function mentionsExport(command: string) {
  return command.includes('导出') || command.includes('geojson') || command.includes('export') || command.includes('download');
}

function assertField(fieldNames: Set<string>, field: string) {
  if (!fieldNames.has(field)) {
    throw new BrainPlanningError({
      code: 'FIELD_NOT_IN_METADATA',
      message: `字段 ${field} 不在当前 Metadata 摘要中。`,
      recoverable: true,
      suggestedUserInput: '请确认字段名，或先搜索字段。',
    });
  }
}

export const defaultBrainGateway = new MockBrainGateway();
