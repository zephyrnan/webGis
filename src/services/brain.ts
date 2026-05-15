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
        operator: normalized.includes('小于') || normalized.includes('<') ? '>' : '>=',
        value: normalized.includes('10') ? 10 : 0,
      });
    }

    if (normalized.includes('name') && (normalized.includes('空') || normalized.includes('为空'))) {
      assertField(fieldNames, 'name');
      operations.push({ action: 'drop_empty', field: 'name' });
    }

    if (normalized.includes('火星') || normalized.includes('gcj')) {
      operations.push({
        action: 'transform_crs',
        from: input.metadata.crs ?? 'EPSG:4326',
        to: 'GCJ-02',
      });
    }

    if (normalized.includes('导出') || normalized.includes('geojson') || operations.length > 0) {
      operations.push({ action: 'export', format: 'geojson' });
    }

    if (operations.length === 0) {
      throw new BrainPlanningError({
        code: 'COMMAND_NOT_UNDERSTOOD',
        message: '当前 MVP 还不能稳定理解这条指令。',
        recoverable: true,
        suggestedUserInput: '可以试试“删除 name 为空的要素，然后导出 GeoJSON”。',
      });
    }

    return { version: input.schemaVersion, operations };
  }
}

function mentionsArea(command: string) {
  return command.includes('area') || command.includes('面积');
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
