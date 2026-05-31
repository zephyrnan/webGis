import { describe, expect, it } from 'vitest';
import { LlmBrainGateway, repairJson } from './llmBrain';

// Access private extractJsonObject via a test-only wrapper
function extractJson(rawText: string): string {
  const gw = new LlmBrainGateway();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (gw as any).extractJsonObject(rawText);
}

describe('extractJsonObject', () => {
  // --- clean JSON ---
  it('parses clean JSON directly', () => {
    const input = '{"version":"1.0","operations":[{"action":"export","format":"geojson"}]}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [{ action: 'export', format: 'geojson' }] });
  });

  // --- markdown code blocks ---
  it('extracts JSON from ```json code block', () => {
    const input = '```json\n{"version":"1.0","operations":[]}\n```';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  it('extracts JSON from ``` code block without language tag', () => {
    const input = '```\n{"version":"1.0","operations":[]}\n```';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  it('extracts JSON from code block with surrounding text', () => {
    const input = 'Here is the AST:\n```json\n{"version":"1.0","operations":[]}\n```\nHope this helps!';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  // --- surrounding explanatory text ---
  it('extracts JSON when LLM adds preamble and explanation', () => {
    const input = 'Based on your request, here is the AST:\n{"version":"1.0","operations":[{"action":"drop_empty","field":"name"}]}\nThis removes features with empty name fields.';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].action).toBe('drop_empty');
  });

  it('extracts JSON when LLM adds only trailing explanation', () => {
    const input = '{"version":"1.0","operations":[]}\n\nNote: I generated an empty operations array because...';
    const result = extractJson(input);
    expect(JSON.parse(result).operations).toEqual([]);
  });

  // --- trailing commas ---
  it('repairs trailing comma before }', () => {
    const input = '{"version":"1.0", "operations": [],}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  it('repairs trailing comma before ]', () => {
    const input = '{"version":"1.0","operations":[{"action":"export","format":"geojson",},]}';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.operations).toHaveLength(1);
  });

  it('repairs multiple trailing commas', () => {
    const input = '{"version":"1.0","operations":[{"action":"drop_empty","field":"name",},{"action":"export","format":"geojson",},],}';
    const result = extractJson(input);
    expect(JSON.parse(result).operations).toHaveLength(2);
  });

  // --- single quotes ---
  it('repairs single-quoted keys and values', () => {
    const input = "{'version':'1.0','operations':[{'action':'export','format':'geojson'}]}";
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('1.0');
    expect(parsed.operations[0].action).toBe('export');
  });

  // --- comments ---
  it('strips single-line // comments', () => {
    const input = '{\n  "version": "1.0",\n  // this is a comment\n  "operations": []\n}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  it('strips multi-line /* */ comments', () => {
    const input = '{\n  "version": "1.0", /* inline comment */\n  "operations": []\n}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  // --- unquoted keys ---
  it('quotes unquoted keys', () => {
    const input = '{version: "1.0", operations: []}';
    const result = extractJson(input);
    expect(JSON.parse(result)).toEqual({ version: '1.0', operations: [] });
  });

  // --- nested objects with explanatory text ---
  it('correctly extracts nested JSON ignoring trailing braces in text', () => {
    const input = '{"version":"1.0","operations":[{"action":"filter_area","field":"area","operator":">","value":0}]}\n\nThe filter_area operation removes features where area <= 0. The {} placeholder is not JSON.';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.operations).toHaveLength(1);
    expect(parsed.operations[0].value).toBe(0);
  });

  // --- error cases ---
  it('throws when no JSON object found', () => {
    expect(() => extractJson('This is just plain text with no JSON at all.')).toThrow();
  });

  it('throws when braces are unbalanced', () => {
    expect(() => extractJson('{"version": "1.0", "operations": [')).toThrow();
  });

  // --- array format ---
  it('extracts array-formatted AST pipeline', () => {
    const input = '[{"action":"drop_empty","field":"name"},{"action":"export","format":"geojson"}]';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed).toHaveLength(2);
  });

  // --- combined issues ---
  it('handles code block + trailing comma + comments', () => {
    const input = '```json\n{\n  "version": "1.0", // schema version\n  "operations": [\n    {"action": "export", "format": "geojson",},\n  ],\n}\n```';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.version).toBe('1.0');
    expect(parsed.operations[0].action).toBe('export');
  });

  // --- preserves string content with braces ---
  it('does not break on braces inside string values', () => {
    const input = '{"version":"1.0","operations":[{"action":"noop","reason":"use {foo} as placeholder"}]}';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.operations[0].reason).toBe('use {foo} as placeholder');
  });

  it('does not break on escaped quotes inside strings', () => {
    const input = '{"version":"1.0","operations":[{"action":"noop","reason":"He said \\"hello\\""}]}';
    const result = extractJson(input);
    const parsed = JSON.parse(result);
    expect(parsed.operations[0].reason).toBe('He said "hello"');
  });
});

describe('repairJson', () => {
  it('returns valid JSON unchanged', () => {
    const input = '{"key":"value"}';
    expect(repairJson(input)).toBe(input);
  });

  it('removes trailing comma before }', () => {
    expect(JSON.parse(repairJson('{"a":1,}'))).toEqual({ a: 1 });
  });

  it('removes trailing comma before ]', () => {
    expect(JSON.parse(repairJson('[1,2,]'))).toEqual([1, 2]);
  });

  it('converts single quotes to double quotes', () => {
    expect(JSON.parse(repairJson("{'a':'b'}"))).toEqual({ a: 'b' });
  });

  it('quotes unquoted keys', () => {
    expect(JSON.parse(repairJson('{a:1,b:2}'))).toEqual({ a: 1, b: 2 });
  });

  it('removes // comments', () => {
    expect(JSON.parse(repairJson('{"a":1 // comment\n}'))).toEqual({ a: 1 });
  });

  it('removes /* */ comments', () => {
    expect(JSON.parse(repairJson('{"a":1 /* comment */}'))).toEqual({ a: 1 });
  });
});
