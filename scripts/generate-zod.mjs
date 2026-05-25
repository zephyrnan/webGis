import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../schemas/ast-schema.json');
const outputPath = resolve(__dirname, '../src/services/astValidation.generated.ts');

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
const defs = schema.$defs;

// Get operation names from the oneOf refs
const opRefs = defs.operation.oneOf.map(r => r.$ref.split('/').pop());

function jsonTypeToZod(prop) {
  if (prop.const !== undefined) {
    return `z.literal(${JSON.stringify(prop.const)})`;
  }
  if (prop.enum) {
    return `z.enum(${JSON.stringify(prop.enum)})`;
  }
  if (prop.type === 'string') {
    let s = 'z.string()';
    if (prop.minLength) s += `.min(${prop.minLength})`;
    return s;
  }
  if (prop.type === 'number') {
    let s = 'z.number().finite()';
    if (prop.exclusiveMinimum !== undefined) s += `.positive()`;
    return s;
  }
  if (prop.type === 'integer') {
    let s = 'z.number().int()';
    if (prop.minimum !== undefined) s += `.min(${prop.minimum})`;
    if (prop.exclusiveMinimum !== undefined) s += `.positive()`;
    return s;
  }
  if (prop.type === 'boolean') {
    return 'z.boolean()';
  }
  if (prop.type === 'array') {
    if (prop.minItems && prop.maxItems && prop.minItems === prop.maxItems) {
      // Fixed-length tuple
      const items = Array.from({ length: prop.minItems }, () => jsonTypeToZod(prop.items));
      return `z.tuple([${items.join(', ')}])`;
    }
    let s = `z.array(${jsonTypeToZod(prop.items)})`;
    if (prop.minItems) s += `.min(${prop.minItems})`;
    return s;
  }
  return 'z.any()';
}

function generateOperationSchema(name) {
  const def = defs[name];
  const props = def.properties;
  const required = new Set(def.required);

  const fields = Object.entries(props).map(([key, prop]) => {
    let zodType = jsonTypeToZod(prop);
    if (!required.has(key)) {
      zodType += '.optional()';
    }
    return `    ${key}: ${zodType},`;
  });

  return `  z.object({\n${fields.join('\n')}\n  })`;
}

const operationSchemas = opRefs.map(generateOperationSchema).join(',\n');

const ts = `// This file is auto-generated from schemas/ast-schema.json — do not edit manually.
// Run: npm run generate:zod
import { z } from 'zod';

export const operationSchema = z.discriminatedUnion('action', [
${operationSchemas},
]);

export const astSchema = z.object({
  version: z.literal('1.0'),
  operations: z.array(operationSchema).min(1),
  target_layer: z.string().optional(),
});
`;

writeFileSync(outputPath, ts);
console.log(`Generated ${outputPath}`);
