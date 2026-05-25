import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../schemas/ast-schema.json');
const outputPath = resolve(__dirname, '../src/services/llmPrompt.generated.ts');

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
const defs = schema.$defs;

const opRefs = defs.operation.oneOf.map(r => r.$ref.split('/').pop());

function describeParams(props, required) {
  return Object.entries(props)
    .filter(([key]) => key !== 'action')
    .map(([key, prop]) => {
      let desc = key;
      if (prop.enum) {
        desc += ` (${prop.enum.join('/')})`;
      } else if (prop.type === 'number' && prop.exclusiveMinimum) {
        desc += ` (>0)`;
      }
      if (!required.has(key)) desc += ' [可选]';
      return desc;
    })
    .join(', ');
}

function generateActionLine(name) {
  const def = defs[name];
  const props = def.properties;
  const required = new Set(def.required);
  const desc = def.description || name;
  const params = describeParams(props, required);
  return `- ${name}: ${desc}。参数: ${params}`;
}

const actionLines = opRefs.map(generateActionLine).join('\n');

const ts = `// This file is auto-generated from schemas/ast-schema.json — do not edit manually.
// Run: npm run generate:prompt

export const AVAILABLE_ACTIONS = \`${actionLines}\`;

export const ACTION_NAMES = ${JSON.stringify(opRefs)};
`;

writeFileSync(outputPath, ts);
console.log(`Generated ${outputPath}`);
