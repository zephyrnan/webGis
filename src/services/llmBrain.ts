import type { GeoSurgicalAst } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { BrainGateway } from './brain';
import { BrainPlanningError } from './brain';
import { validateAst } from './astValidation';
import { AVAILABLE_ACTIONS, ACTION_NAMES } from './llmPrompt.generated';
import { isTauriRuntime } from './tauriRuntime';

const SYSTEM_PROMPT = `You are a REST API that outputs ONLY raw JSON. Do NOT wrap the JSON in markdown blocks (like \`\`\`json). Do NOT add any conversational text before or after the JSON. Your output must start with '{' and end with '}'.

你是 GeoSurgical 编译器。你的唯一职责是将用户的自然语言指令翻译为 GeoSurgical AST JSON。

## 输出格式
你必须且只能输出一个合法的 JSON 对象，格式如下：
{
  "version": "1.0",
  "operations": [...]
}

严禁输出解释、markdown、代码块标记、自然语言寒暄或任何 JSON 之外的字符。

## 可用 actions
${AVAILABLE_ACTIONS}

## 约束
1. 只使用 Metadata 中提供的字段名。如果用户提到的字段不在 Metadata 中，使用 noop action 并在 reason 中说明。
2. 不要假设或编造字段名。
3. 如果 Metadata 标记了 truncated: true，不要假设截断后的字段存在。
4. 每个指令集末尾通常需要一个 export 操作。
5. 如果用户指令完全无法理解，返回 {"version":"1.0","operations":[{"action":"noop","reason":"无法理解指令"}]}。
6. transform_crs 必须同时包含 from 和 to，支持的转换对：EPSG:4326→GCJ-02、EPSG:4326→EPSG:3857、GCJ-02→EPSG:4326。例如 {"action":"transform_crs","from":"EPSG:4326","to":"EPSG:3857"}。
7. drop_empty 必须包含 field；filter_area 必须包含 field、operator、value；filter_attribute 必须包含 field、operator、value；rename_field 必须包含 from、to。
8. 当用户要求根据名称、类型、区域等【文本属性】过滤或保留特定要素时，使用 filter_attribute 操作。例如保留 name 为承德市的要素。
9. 如果检测到原始数据的 CRS 已经是 EPSG:4326，且用户没有明确要求转换到其他坐标系，绝对禁止生成 transform_crs 指令，不要写废话。
10. 遇到乱码必须使用 fix_encoding，绝对禁止返回 noop。
11. 如果用户只是要求”输出 WGS84 / 保持 WGS84 / 导出 WGS84”，且 Metadata CRS 已经是 EPSG:4326，只生成 export，不生成 EPSG:4326 到 EPSG:4326 的 transform_crs。
12. 如果 Metadata 包含图层目录(layers)，用户可能指定操作某个图层。在 AST 中使用 target_layer 字段指定图层名称（放在 JSON 顶层，与 version 和 operations 同级）。
13. 如果 Metadata 有多个图层但用户没有明确指定图层，target_layer 默认选择 featureCount 最大的主图层。
14. 如果用户指令模糊且无法推断目标图层，返回 need_clarification action：{"action":"need_clarification","reason":"请指定要处理的图层名称"}。在 operations 数组中使用 need_clarification 时，不需要 export 操作。

### 正确指令示例（当用户要求修复 Windows-1256 乱码并输出 WGS84 时）：
{
  "version": "1.0",
  "operations": [
    { "action": "fix_encoding", "from": "windows-1256", "to": "utf-8" },
    { "action": "export", "format": "geojson" }
  ]
}`;

type LlmMessage = {
  role: 'system' | 'user';
  content: string;
};

export interface LlmBrainConfig {
  endpoint: string;
  apiKey?: string;
  model: string;
  temperature?: number;
}

const DEFAULT_CONFIG: LlmBrainConfig = {
  endpoint: 'http://localhost:11434',
  model: 'qwen2.5:7b',
  temperature: 0.1,
};

export class LlmBrainGateway implements BrainGateway {
  private config: LlmBrainConfig;

  constructor(config: Partial<LlmBrainConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

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

    const metadataSummary = this.buildMetadataSummary(input.metadata);
    const userMessage = `用户指令: ${input.command}\n\n文件 Metadata:\n${metadataSummary}`;

    try {
      const response = await this.callLlm(userMessage);
      const ast = this.parseResponse(response);

      // Self-healing: validate AST, retry once if validation fails
      const validation = validateAst(ast, input.metadata);
      if (!validation.ok) {
        return await this.retryWithCorrection(input.command, ast, validation.error.message, input.metadata);
      }

      return ast;
    } catch (error) {
      if (error instanceof BrainPlanningError) throw error;
      throw new BrainPlanningError({
        code: 'LLM_CALL_FAILED',
        message: `调用大模型失败: ${error instanceof Error ? error.message : '未知错误'}`,
        recoverable: true,
        suggestedUserInput: '请检查本地 Ollama 服务是否运行，或尝试使用 Mock 模式。',
      });
    }
  }

  private async retryWithCorrection(
    originalCommand: string,
    failedAst: GeoSurgicalAst,
    validationError: string,
    metadata: GeoSurgicalMetadata,
  ): Promise<GeoSurgicalAst> {
    const fieldNames = metadata.fields.map((f) => f.name);
    const layerNames = metadata.layers?.map((l) => l.name) ?? [];
    const correctionPrompt = [
      '你生成的 AST 校验失败。',
      `原始用户指令: ${originalCommand}`,
      `你上次输出的 AST: ${JSON.stringify(failedAst)}`,
      `校验错误: ${validationError}`,
      `合法字段: [${fieldNames.map((f) => `"${f}"`).join(', ')}]`,
      layerNames.length ? `合法图层: [${layerNames.map((l) => `"${l}"`).join(', ')}]` : '',
      `合法 actions: ${ACTION_NAMES.join(', ')}`,
      '请只输出修正后的 JSON，不要解释。',
    ].filter(Boolean).join('\n');

    try {
      const retryResponse = await this.callLlm(correctionPrompt);
      const retryAst = this.parseResponse(retryResponse);

      // Validate the retry result — if it still fails, throw the original error
      const retryValidation = validateAst(retryAst, metadata);
      if (!retryValidation.ok) {
        throw new BrainPlanningError({
          code: 'AST_VALIDATION_FAILED',
          message: `AST 校验失败（已重试一次）: ${validationError}`,
          recoverable: true,
          suggestedUserInput: '请检查指令中的字段名和操作是否正确，或简化指令后重试。',
        });
      }

      return retryAst;
    } catch (error) {
      if (error instanceof BrainPlanningError) throw error;
      throw new BrainPlanningError({
        code: 'AST_VALIDATION_FAILED',
        message: `AST 校验失败（重试时 LLM 调用出错）: ${validationError}`,
        recoverable: true,
        suggestedUserInput: '请检查指令中的字段名和操作是否正确。',
      });
    }
  }

  private buildMetadataSummary(metadata: GeoSurgicalMetadata): string {
    const lines: string[] = [
      `文件类型: ${metadata.fileType}`,
      `文件名: ${metadata.fileName}`,
      `要素数量: ${metadata.featureCountEstimate ?? '未知'}`,
      `坐标系: ${metadata.crs ?? '未知'}`,
    ];

    if (metadata.bbox) {
      lines.push(`BBox: [${metadata.bbox.join(', ')}]`);
    }

    lines.push(`字段总数: ${metadata.fieldPolicy.totalFieldCount}`);
    if (metadata.fieldPolicy.truncated) {
      lines.push(`字段已截断: 显示前 ${metadata.fieldPolicy.includedFieldCount} 个`);
    }

    lines.push('\n字段列表:');
    for (const field of metadata.fields) {
      const sampleStr = field.sample?.length
        ? ` (示例: ${field.sample.slice(0, 3).map(v => JSON.stringify(v)).join(', ')})`
        : '';
      lines.push(`  - ${field.name}: ${field.type}${sampleStr}`);
    }

    if (metadata.layers?.length) {
      lines.push('\n图层目录:');
      for (const layer of metadata.layers) {
        lines.push(`  - ${layer.name}: ${layer.featureCount ?? '未知'} 要素, ${layer.fields.length} 字段`);
      }
    }

    return lines.join('\n');
  }

  private async callLlm(userMessage: string): Promise<string> {
    const { endpoint, apiKey, model, temperature } = this.config;
    const messages: LlmMessage[] = [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userMessage },
    ];

    if (isTauriRuntime()) {
      return this.callTauri(messages, temperature);
    }

    const isOpenAiFormat = endpoint.includes('api.openai.com')
      || endpoint.includes('deepseek')
      || endpoint.includes('openai.com')
      || endpoint.includes('modelscope')
      || endpoint.includes('siliconflow')
      || endpoint.includes('v1/chat/completions');

    if (isOpenAiFormat) {
      return this.callOpenAiFormat(endpoint, apiKey, model, temperature, messages);
    }

    // Default: Ollama format
    return this.callOllama(endpoint, model, temperature, messages);
  }

  private async callTauri(messages: LlmMessage[], temperature: number | undefined): Promise<string> {
    const { invoke } = await import('@tauri-apps/api/core');
    return invoke<string>('invoke_llm', {
      messages,
      responseFormat: 'json',
      temperature: temperature ?? 0.1,
    });
  }

  private async callOllama(endpoint: string, model: string, temperature: number | undefined, messages: LlmMessage[]): Promise<string> {
    const response = await fetch(`${endpoint}/api/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages,
        stream: false,
        format: 'json',
        options: { temperature: temperature ?? 0.1 },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Ollama API 返回 ${response.status}: ${text}`);
    }

    const data = await response.json() as { message?: { content?: string } };
    return data.message?.content ?? '';
  }

  private async callOpenAiFormat(endpoint: string, apiKey: string | undefined, model: string, temperature: number | undefined, messages: LlmMessage[]): Promise<string> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;
    const url = endpoint.includes('/v1/chat/completions')
      ? endpoint
      : `${endpoint.replace(/\/$/, '')}/v1/chat/completions`;

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        messages,
        temperature: temperature ?? 0.1,
        stream: false,
        response_format: { type: 'json_object' },
      }),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`OpenAI API 返回 ${response.status}: ${text}`);
    }

    const data = await response.json() as { choices?: Array<{ message?: { content?: string } }> };
    return data.choices?.[0]?.message?.content ?? '';
  }

  private parseResponse(response: string): GeoSurgicalAst {
    const cleaned = this.extractJsonObject(response);

    try {
      const parsed = JSON.parse(cleaned) as unknown;
      const ast = this.normalizeAst(parsed);

      if (!ast.version || !Array.isArray(ast.operations)) {
        throw new BrainPlanningError({
          code: 'INVALID_AST_FORMAT',
          message: '大模型返回的 JSON 格式不符合 AST 规范。',
          recoverable: true,
        });
      }

      return ast;
    } catch (error) {
      if (error instanceof BrainPlanningError) throw error;
      console.error('LLM 返回的不是合法 JSON:', response);
      throw new BrainPlanningError({
        code: 'LLM_JSON_PARSE_ERROR',
        message: `大模型返回的内容不是合法 JSON: ${error instanceof Error ? error.message : '未知错误'}`,
        recoverable: true,
        suggestedUserInput: '请尝试重新生成，或简化指令。',
      });
    }
  }

  private normalizeAst(parsed: unknown): GeoSurgicalAst {
    const value = parsed as Partial<GeoSurgicalAst> & { operations?: unknown };
    const operations = Array.isArray(value.operations)
      ? value.operations.map((operation) => this.normalizeOperation(operation))
      : [];

    return {
      version: value.version === '1.0' ? '1.0' : '1.0',
      operations,
      target_layer: typeof value.target_layer === 'string' ? value.target_layer : undefined,
    };
  }

  private normalizeOperation(operation: unknown): GeoSurgicalAst['operations'][number] {
    const op = operation as Record<string, unknown>;
    const action = String(op.action ?? '').trim();

    if (action === 'transform_crs') {
      return {
        action: 'transform_crs',
        from: typeof op.from === 'string' && op.from ? op.from : 'EPSG:4326',
        to: op.to === 'EPSG:3857' || op.to === 'EPSG:4326' || op.to === 'GCJ-02' ? op.to : 'GCJ-02',
      };
    }

    if (action === 'reproject') {
      const fromEpsg = typeof op.from_epsg === 'number' ? op.from_epsg : Number(op.from_epsg ?? 4326);
      const toEpsg = typeof op.to_epsg === 'number' ? op.to_epsg : Number(op.to_epsg ?? 4326);
      return {
        action: 'reproject',
        from_epsg: fromEpsg >= 1024 && fromEpsg <= 32767 ? fromEpsg : 4326,
        to_epsg: toEpsg >= 1024 && toEpsg <= 32767 ? toEpsg : 4326,
      };
    }

    if (action === 'fix_encoding') {
      return {
        action: 'fix_encoding',
        from: typeof op.from === 'string' && op.from ? op.from : 'unknown',
        to: 'utf-8',
      };
    }

    if (action === 'filter_area') {
      return {
        action: 'filter_area',
        field: typeof op.field === 'string' && op.field ? op.field : 'area',
        operator: op.operator === '>' || op.operator === '<' || op.operator === '<=' || op.operator === '=' ? op.operator : '>=',
        value: typeof op.value === 'number' ? op.value : Number(op.value ?? 0),
      };
    }

    if (action === 'filter_attribute') {
      return {
        action: 'filter_attribute',
        field: typeof op.field === 'string' && op.field ? op.field : 'name',
        operator: op.operator === '!=' || op.operator === 'contains' ? op.operator : '==',
        value: typeof op.value === 'string' ? op.value : String(op.value ?? ''),
      };
    }

    if (action === 'drop_empty') {
      return {
        action: 'drop_empty',
        field: typeof op.field === 'string' && op.field ? op.field : 'name',
      };
    }

    if (action === 'rename_field') {
      return {
        action: 'rename_field',
        from: typeof op.from === 'string' ? op.from : '',
        to: typeof op.to === 'string' ? op.to : '',
      };
    }

    if (action === 'export') {
      return { action: 'export', format: 'geojson' };
    }

    if (action === 'simplify') {
      return {
        action: 'simplify',
        tolerance: typeof op.tolerance === 'number' && op.tolerance > 0 ? op.tolerance : 0.0001,
        preserve_topology: typeof op.preserve_topology === 'boolean' ? op.preserve_topology : true,
      };
    }

    if (action === 'field_calculate') {
      const operands = Array.isArray(op.operands) && op.operands.length === 2
        ? [String(op.operands[0]), String(op.operands[1])]
        : ['0', '0'];
      const validOps = ['add', 'subtract', 'multiply', 'divide'];
      return {
        action: 'field_calculate',
        target_field: typeof op.target_field === 'string' && op.target_field ? op.target_field : 'result',
        operation: validOps.includes(String(op.operation)) ? String(op.operation) as 'add' | 'subtract' | 'multiply' | 'divide' : 'add',
        operands: operands as [string, string],
      };
    }

    if (action === 'validate_geometry') {
      return {
        action: 'validate_geometry',
        mode: op.mode === 'check' ? 'check' : 'check_and_fix',
      };
    }

    if (action === 'buffer') {
      return {
        action: 'buffer',
        distance: typeof op.distance === 'number' && op.distance > 0 ? op.distance : 100,
        segments: typeof op.segments === 'number' && op.segments > 0 ? Math.round(op.segments) : undefined,
      };
    }

    if (action === 'clip') {
      const bbox: [number, number, number, number] = Array.isArray(op.bbox) && op.bbox.length === 4
        ? [Number(op.bbox[0]), Number(op.bbox[1]), Number(op.bbox[2]), Number(op.bbox[3])]
        : [0, 0, 0, 0];
      return { action: 'clip', bbox };
    }

    if (action === 'intersect') {
      const bbox: [number, number, number, number] = Array.isArray(op.bbox) && op.bbox.length === 4
        ? [Number(op.bbox[0]), Number(op.bbox[1]), Number(op.bbox[2]), Number(op.bbox[3])]
        : [0, 0, 0, 0];
      return { action: 'intersect', bbox };
    }

    if (action === 'dissolve') {
      return {
        action: 'dissolve',
        field: typeof op.field === 'string' && op.field ? op.field : 'name',
      };
    }

    if (action === 'need_clarification') {
      return {
        action: 'need_clarification',
        reason: typeof op.reason === 'string' && op.reason ? op.reason : '需要用户指定目标图层。',
      };
    }

    return {
      action: 'noop',
      reason: typeof op.reason === 'string' && op.reason ? op.reason : `不支持或无法归一化的 action: ${action || 'unknown'}`,
    };
  }

  private extractJsonObject(rawText: string): string {
    // Strategy 1: Extract from ```json ... ``` code block (highest priority)
    const codeBlockMatch = rawText.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
    if (codeBlockMatch) {
      const inner = codeBlockMatch[1].trim();
      if (inner.startsWith('{') || inner.startsWith('[')) {
        return repairJson(inner);
      }
    }

    // Strategy 2: Find balanced { ... } using brace counting
    const objStart = rawText.indexOf('{');
    const arrStart = rawText.indexOf('[');

    // Determine which bracket type starts first
    let start = -1;
    let end = -1;
    let openChar = '';
    let closeChar = '';

    if (objStart !== -1 && (arrStart === -1 || objStart < arrStart)) {
      start = objStart;
      openChar = '{';
      closeChar = '}';
    } else if (arrStart !== -1) {
      start = arrStart;
      openChar = '[';
      closeChar = ']';
    }

    if (start !== -1) {
      let depth = 0;
      let inString = false;
      let escape = false;
      for (let i = start; i < rawText.length; i++) {
        const ch = rawText[i];
        if (escape) { escape = false; continue; }
        if (ch === '\\') { escape = true; continue; }
        if (ch === '"') { inString = !inString; continue; }
        if (inString) continue;
        if (ch === openChar) depth++;
        if (ch === closeChar) {
          depth--;
          if (depth === 0) { end = i; break; }
        }
      }
    }

    if (start !== -1 && end !== -1 && end > start) {
      const extracted = rawText.slice(start, end + 1).trim();
      return repairJson(extracted);
    }

    throw new BrainPlanningError({
      code: 'LLM_JSON_PARSE_ERROR',
      message: '大模型返回内容中没有找到完整的 JSON 对象或数组。',
      recoverable: true,
      suggestedUserInput: '请重新生成 AST，或切换到 Mock 模式。',
    });
  }
}

/**
 * Repair common JSON formatting issues from LLM output:
 * - Trailing commas before } or ]
 * - Single quotes → double quotes (simple cases)
 * - // and /* comments
 * - Unquoted keys
 */
export function repairJson(raw: string): string {
  let text = raw;

  // Remove single-line comments: // ...
  text = text.replace(/(?<!["\w])\/\/[^\n]*/g, '');
  // Remove multi-line comments: /* ... */
  text = text.replace(/\/\*[\s\S]*?\*\//g, '');

  // Replace single quotes with double quotes (outside of existing double-quoted strings)
  // Simple heuristic: only replace ' when not inside a "..." string
  text = replaceSingleQuotes(text);

  // Remove trailing commas before } or ]
  text = text.replace(/,(\s*[}\]])/g, '$1');

  // Quote unquoted keys: { key: "value" } → { "key": "value" }
  text = text.replace(/(?<=[{,]\s*)([a-zA-Z_$][a-zA-Z0-9_$]*)\s*:/g, '"$1":');

  return text;
}

function replaceSingleQuotes(text: string): string {
  let result = '';
  let inDouble = false;
  let escape = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (escape) { result += ch; escape = false; continue; }
    if (ch === '\\') { result += ch; escape = true; continue; }
    if (ch === '"') { inDouble = !inDouble; result += ch; continue; }
    if (ch === "'" && !inDouble) {
      result += '"';
      continue;
    }
    result += ch;
  }
  return result;
}

export function createBrainGateway(config: Partial<LlmBrainConfig> & { mode?: 'llm' | 'mock' } = {}) {
  const { mode, ...llmConfig } = config;

  if (mode === 'mock') {
    return null; // Will use defaultBrainGateway
  }

  return new LlmBrainGateway(llmConfig);
}
