use super::*;

pub(crate) fn operation_name(op: &Operation) -> &str {
    match op {
        Operation::FilterArea { .. } => "filter_area",
        Operation::FilterAttribute { .. } => "filter_attribute",
        Operation::DropEmpty { .. } => "drop_empty",
        Operation::RenameField { .. } => "rename_field",
        Operation::TransformCrs { .. } => "transform_crs",
        Operation::FixEncoding { .. } => "fix_encoding",
        Operation::Simplify { .. } => "simplify",
        Operation::FieldCalculate { .. } => "field_calculate",
        Operation::ValidateGeometry { .. } => "validate_geometry",
        Operation::Buffer { .. } => "buffer",
        Operation::Clip { .. } => "clip",
        Operation::Intersect { .. } => "intersect",
        Operation::Dissolve { .. } => "dissolve",
        Operation::Export { .. } => "export",
        Operation::Noop { .. } => "noop",
        Operation::NeedClarification { .. } => "need_clarification",
    }
}

pub(crate) fn emit_progress(callback: &Option<Function>, phase: &str, message: &str, percent: u32) {
    if let Some(ref cb) = callback {
        let obj = js_sys::Object::new();
        js_sys::Reflect::set(&obj, &"phase".into(), &phase.into()).ok();
        js_sys::Reflect::set(&obj, &"message".into(), &message.into()).ok();
        js_sys::Reflect::set(&obj, &"percent".into(), &percent.into()).ok();
        let _ = cb.call1(&wasm_bindgen::JsValue::NULL, &obj);
    }
}
