import { compile } from 'json-schema-to-typescript';
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../schemas/ast-schema.json');
const outputPath = resolve(__dirname, '../src/types/ast.generated.ts');

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));

let ts = await compile(schema, 'GeoSurgicalAST', {
  bannerComment: '// This file is auto-generated from schemas/ast-schema.json — do not edit manually.\n// Run: npm run generate:types',
  unreachableDefinitions: false,
  additionalProperties: false,
});

// Fix: replace non-empty tuple type with regular array for compatibility
ts = ts.replace(/\[Operation, \.\.\.Operation\[\]\]/g, 'Operation[]');

writeFileSync(outputPath, ts);
console.log(`Generated ${outputPath}`);
