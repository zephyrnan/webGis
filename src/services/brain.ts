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
      const to = detectCrsTarget(normalized);
      operations.push({
        action: 'transform_crs',
        from: to === 'GCJ-02' ? (input.metadata.crs ?? 'EPSG:4326') : 'EPSG:4326',
        to,
      });
    }

    if (mentionsSimplify(normalized)) {
      operations.push({
        action: 'simplify',
        tolerance: extractTolerance(normalized),
        preserve_topology: true,
      });
    }

    if (mentionsFieldCalculate(normalized)) {
      const { targetField, operation, operands } = extractFieldCalc(normalized);
      if (targetField) {
        operations.push({
          action: 'field_calculate',
          target_field: targetField,
          operation,
          operands,
        });
      }
    }

    if (mentionsValidateGeometry(normalized)) {
      operations.push({
        action: 'validate_geometry',
        mode: normalized.includes('修复') || normalized.includes('fix') ? 'check_and_fix' : 'check',
      });
    }

    if (mentionsFixEncoding(normalized)) {
      const fromEncoding = extractEncoding(normalized);
      operations.push({
        action: 'fix_encoding',
        from: fromEncoding,
        to: 'utf-8',
      });
    }

    if (mentionsBuffer(normalized)) {
      operations.push({
        action: 'buffer',
        distance: extractBufferDistance(normalized),
        segments: 32,
      });
    }

    if (mentionsClip(normalized)) {
      const bbox = extractBbox(normalized, input.metadata);
      if (bbox) {
        operations.push({ action: 'clip', bbox });
      }
    }

    if (mentionsIntersect(normalized)) {
      const bbox = extractBbox(normalized, input.metadata);
      if (bbox) {
        operations.push({ action: 'intersect', bbox });
      }
    }

    if (mentionsDissolve(normalized)) {
      const field = extractDissolveField(normalized, input.metadata);
      if (field) {
        operations.push({ action: 'dissolve', field });
      }
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
    || command.includes('3857')
    || command.includes('mercator')
    || command.includes('投影')
    || command.includes('反纠偏')
    || command.includes('反向')
    || command.includes('convert')
    || command.includes('transform');
}

function detectCrsTarget(command: string): 'EPSG:3857' | 'EPSG:4326' | 'GCJ-02' {
  if (command.includes('3857') || command.includes('mercator') || command.includes('投影')) return 'EPSG:3857';
  if (command.includes('反纠偏') || command.includes('反向') || command.includes('4326')) return 'EPSG:4326';
  return 'GCJ-02';
}

function mentionsSimplify(command: string) {
  return command.includes('简化') || command.includes('抽稀') || command.includes('simplify') || command.includes('reduce vertices') || command.includes('thin');
}

function extractTolerance(command: string): number {
  const match = command.match(/(\d+\.?\d*)/);
  if (match) {
    const val = parseFloat(match[1]);
    if (val > 0 && val < 1) return val;
  }
  return 0.0001;
}

function mentionsFieldCalculate(command: string) {
  return command.includes('计算')
    || command.includes('求密度')
    || command.includes('除以')
    || command.includes('乘以')
    || command.includes('calculate')
    || command.includes('density')
    || command.includes('divide')
    || command.includes('multiply');
}

function extractFieldCalc(command: string): { targetField: string | null; operation: 'add' | 'subtract' | 'multiply' | 'divide'; operands: [string, string] } {
  let operation: 'add' | 'subtract' | 'multiply' | 'divide' = 'add';
  if (command.includes('除') || command.includes('divide')) operation = 'divide';
  else if (command.includes('乘') || command.includes('multiply')) operation = 'multiply';
  else if (command.includes('减') || command.includes('subtract')) operation = 'subtract';

  let targetField: string | null = null;
  if (command.includes('密度') || command.includes('density')) targetField = 'density';

  const operands: [string, string] = ['0', '0'];
  if (operation === 'divide' && (command.includes('密度') || command.includes('density'))) {
    operands[0] = 'population';
    operands[1] = 'area';
  }

  return { targetField, operation, operands };
}

function mentionsValidateGeometry(command: string) {
  return command.includes('校验')
    || command.includes('检查几何')
    || command.includes('修复几何')
    || command.includes('validate')
    || command.includes('check geometry')
    || command.includes('fix geometry');
}

function mentionsFixEncoding(command: string) {
  return command.includes('乱码')
    || command.includes('编码')
    || command.includes('encoding')
    || command.includes('fix_encoding')
    || command.includes('fix encoding')
    || command.includes('转码')
    || command.includes('gbk')
    || command.includes('gb2312')
    || command.includes('big5')
    || command.includes('windows-125')
    || command.includes('shift_jis')
    || command.includes('euc-')
    || command.includes('iso-8859');
}

function extractEncoding(command: string): string {
  if (command.includes('gbk')) return 'gbk';
  if (command.includes('gb2312')) return 'gb2312';
  if (command.includes('big5')) return 'big5';
  if (command.includes('windows-1256')) return 'windows-1256';
  if (command.includes('windows-1251')) return 'windows-1251';
  if (command.includes('windows-1252')) return 'windows-1252';
  if (command.includes('windows-125')) return 'windows-1256';
  if (command.includes('shift_jis') || command.includes('shift-jis')) return 'shift_jis';
  if (command.includes('euc-jp')) return 'euc-jp';
  if (command.includes('euc-kr')) return 'euc-kr';
  if (command.includes('iso-8859-1')) return 'iso-8859-1';
  if (command.includes('iso-8859')) return 'iso-8859-1';
  return 'unknown';
}

function mentionsExport(command: string) {
  return command.includes('导出') || command.includes('geojson') || command.includes('export') || command.includes('download');
}

function mentionsBuffer(command: string) {
  return command.includes('缓冲') || command.includes('buffer') || command.includes('膨胀') || command.includes('expand');
}

function extractBufferDistance(command: string): number {
  const match = command.match(/(\d+\.?\d*)/);
  if (match) {
    const val = parseFloat(match[1]);
    if (val > 0) return val;
  }
  return 100;
}

function mentionsClip(command: string) {
  return command.includes('裁剪') || command.includes('clip') || command.includes('crop') || command.includes('trim');
}

function mentionsIntersect(command: string) {
  return command.includes('相交') || command.includes('intersect') || command.includes('intersection') || command.includes('求交');
}

function mentionsDissolve(command: string) {
  return command.includes('融合') || command.includes('合并') || command.includes('dissolve') || command.includes('merge') || command.includes('union');
}

function extractBbox(command: string, metadata: GeoSurgicalMetadata): [number, number, number, number] | null {
  // Try to extract bbox from metadata if available
  if (metadata.bbox) return metadata.bbox;
  return null;
}

function extractDissolveField(command: string, metadata: GeoSurgicalMetadata): string | null {
  // Try to find a field name mentioned in the command
  for (const field of metadata.fields) {
    if (command.includes(field.name.toLowerCase())) return field.name;
  }
  // Default fallback
  if (command.includes('name')) return 'name';
  if (metadata.fields.length > 0) return metadata.fields[0].name;
  return null;
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
