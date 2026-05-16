mod metadata;
mod dispatcher;
mod types;

use wasm_bindgen::prelude::*;
use js_sys::Function;

#[wasm_bindgen]
pub struct GeoSurgicalEngine {
    progress_callback: Option<Function>,
}

#[wasm_bindgen]
impl GeoSurgicalEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        GeoSurgicalEngine {
            progress_callback: None,
        }
    }

    #[wasm_bindgen(js_name = setProgressCallback)]
    pub fn set_progress_callback(&mut self, callback: Function) {
        self.progress_callback = Some(callback);
    }

    #[wasm_bindgen(js_name = extractMetadata)]
    pub fn extract_metadata(&self, input: &[u8], file_name: &str, file_size: f64) -> Result<String, JsError> {
        self.emit_progress("metadata", "开始提取元数据...", 5);
        let meta = metadata::extract(input, file_name, file_size)?;
        self.emit_progress("metadata", "Metadata Dry Run 完成。", 100);
        Ok(meta)
    }

    #[wasm_bindgen(js_name = executeSurgery)]
    pub fn execute_surgery(&self, input: &[u8], ast_json: &str, file_name: &str, file_size: f64) -> Result<Vec<u8>, JsError> {
        self.emit_progress("executing", "开始解析 AST...", 5);
        let ast: types::GeoSurgicalAst = serde_json::from_str(ast_json)
            .map_err(|e| JsError::new(&format!("AST 解析失败: {}", e)))?;

        self.emit_progress("executing", "开始执行 GeoSurgical 手术...", 10);
        let result = dispatcher::execute(input, &ast, file_name, file_size, &self.progress_callback)?;
        self.emit_progress("exporting", "结果已生成。", 100);
        Ok(result)
    }

    fn emit_progress(&self, phase: &str, message: &str, percent: u32) {
        if let Some(ref cb) = self.progress_callback {
            let obj = js_sys::Object::new();
            js_sys::Reflect::set(&obj, &"phase".into(), &phase.into()).ok();
            js_sys::Reflect::set(&obj, &"message".into(), &message.into()).ok();
            js_sys::Reflect::set(&obj, &"percent".into(), &percent.into()).ok();
            let _ = cb.call1(&JsValue::NULL, &obj);
        }
    }
}
