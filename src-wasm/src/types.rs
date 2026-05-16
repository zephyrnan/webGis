use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GeoSurgicalAst {
    pub version: String,
    pub operations: Vec<Operation>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "action")]
pub enum Operation {
    #[serde(rename = "filter_area")]
    FilterArea {
        field: String,
        operator: String,
        value: f64,
    },
    #[serde(rename = "drop_empty")]
    DropEmpty { field: String },
    #[serde(rename = "rename_field")]
    RenameField { from: String, to: String },
    #[serde(rename = "transform_crs")]
    TransformCrs { from: String, to: String },
    #[serde(rename = "fix_encoding")]
    FixEncoding { from: String, to: String },
    #[serde(rename = "export")]
    Export { format: String },
    #[serde(rename = "noop")]
    Noop { reason: String },
}

#[derive(Debug, Clone, Serialize)]
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
    pub encoding: Option<String>,
    #[serde(rename = "fieldPolicy")]
    pub field_policy: FieldPolicy,
    pub warnings: Vec<GeoWarning>,
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
