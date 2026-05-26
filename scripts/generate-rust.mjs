import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const schemaPath = resolve(__dirname, '../schemas/ast-schema.json');
const outputPath = resolve(__dirname, '../src-wasm/src/types.rs');

const schema = JSON.parse(readFileSync(schemaPath, 'utf-8'));
const defs = schema.$defs;

const opRefs = defs.operation.oneOf.map(r => r.$ref.split('/').pop());

function pascalCase(snake) {
  return snake.split('_').map(s => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

function jsonTypeToRust(prop) {
  if (prop.const !== undefined) return null;
  if (prop.type === 'string') return 'String';
  if (prop.type === 'number') return 'f64';
  if (prop.type === 'integer') return 'u32';
  if (prop.type === 'boolean') return 'bool';
  if (prop.type === 'array') {
    const inner = jsonTypeToRust(prop.items);
    if (prop.minItems && prop.maxItems && prop.minItems === prop.maxItems && inner === 'f64') {
      return `[f64; ${prop.minItems}]`;
    }
    return `Vec<${inner}>`;
  }
  return 'serde_json::Value';
}

function generateVariant(name) {
  const def = defs[name];
  const props = def.properties;
  const required = new Set(def.required);
  const pascalName = pascalCase(name);

  const fields = [];
  for (const [key, prop] of Object.entries(props)) {
    if (prop.const !== undefined) continue;
    const rustType = jsonTypeToRust(prop);
    if (!required.has(key)) {
      fields.push(`        #[serde(skip_serializing_if = "Option::is_none")]\n        ${key}: Option<${rustType}>,`);
    } else {
      fields.push(`        ${key}: ${rustType},`);
    }
  }

  if (fields.length === 0) {
    return `    #[serde(rename = "${name}")]\n    ${pascalName},`;
  }

  return `    #[serde(rename = "${name}")]\n    ${pascalName} {\n${fields.join('\n')}\n    },`;
}

const variants = opRefs.map(generateVariant).join('\n');

// Read the existing types.rs to preserve non-AST types (metadata, result, etc.)
const existingPath = resolve(__dirname, '../src-wasm/src/types.rs');
let existingContent;
try {
  existingContent = readFileSync(existingPath, 'utf-8');
} catch {
  existingContent = '';
}

// Extract the manually-maintained types (everything after the Operation enum)
const manualTypesStart = existingContent.indexOf('\n#[derive(Debug, Clone, Serialize)]\npub struct GeoField');
const manualTypes = manualTypesStart >= 0
  ? existingContent.slice(manualTypesStart)
  : `

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoField {
    pub name: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub sample: Vec<serde_json::Value>,
    #[serde(rename = "nullRateEstimate")]
    pub null_rate_estimate: f64,
}

#[derive(Debug, Clone, Serialize)]
pub struct FieldPolicy {
    #[serde(rename = "totalFieldCount")]
    pub total_field_count: usize,
    #[serde(rename = "includedFieldCount")]
    pub included_field_count: usize,
    pub truncated: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeoWarning {
    pub code: String,
    pub message: String,
    pub recoverable: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    #[serde(rename = "suggestedUserInput")]
    pub suggested_user_input: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct GeoSurgicalMetadata {
    #[serde(rename = "fileType")]
    pub file_type: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(rename = "fileSize")]
    pub file_size: f64,
    #[serde(rename = "featureCountEstimate")]
    pub feature_count_estimate: Option<usize>,
    pub fields: Vec<GeoField>,
    pub bbox: Option<[f64; 4]>,
    pub crs: Option<String>,
    #[serde(rename = "crsConfidence", skip_serializing_if = "Option::is_none")]
    pub crs_confidence: Option<String>,
    pub encoding: Option<String>,
    #[serde(rename = "fieldPolicy")]
    pub field_policy: FieldPolicy,
    pub warnings: Vec<GeoWarning>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub layers: Option<Vec<LayerInfo>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct LayerInfo {
    pub name: String,
    #[serde(rename = "featureCount")]
    pub feature_count: Option<usize>,
    pub fields: Vec<GeoField>,
    pub bbox: Option<[f64; 4]>,
    pub crs: Option<String>,
    #[serde(rename = "crsConfidence", skip_serializing_if = "Option::is_none")]
    pub crs_confidence: Option<String>,
    pub encoding: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct SurgerySummary {
    #[serde(rename = "inputFeatureCount")]
    pub input_feature_count: Option<usize>,
    #[serde(rename = "outputFeatureCount")]
    pub output_feature_count: Option<usize>,
    pub operations: Vec<String>,
    #[serde(rename = "mockMode")]
    pub mock_mode: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SurgeryResult {
    pub kind: String,
    #[serde(rename = "fileName")]
    pub file_name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub content: Option<serde_json::Value>,
    #[serde(rename = "previewContent", skip_serializing_if = "Option::is_none")]
    pub preview_content: Option<serde_json::Value>,
    pub summary: SurgerySummary,
    pub logs: Vec<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
pub struct UndoCapability {
    pub available: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub reason: Option<String>,
    pub strategy: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct SurgeryEnvelope {
    pub result: SurgeryResult,
    pub undo: UndoCapability,
}
`;

const rs = `// AST types are auto-generated from schemas/ast-schema.json — do not edit manually.
// Run: npm run generate:rust
// Non-AST types (metadata, result, envelope) are preserved from the previous version.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoSurgicalAst {
    pub version: String,
    pub operations: Vec<Operation>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub target_layer: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum Operation {
${variants}
}
${manualTypes}`;

writeFileSync(outputPath, rs);
console.log(`Generated ${outputPath}`);
