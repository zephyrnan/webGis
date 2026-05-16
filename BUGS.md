# Bugs and Known Issues

## BUG-001: ZIP Shapefile execution parsed binary as GeoJSON

- Status: Fixed
- Date: 2026-05-16
- Scenario: Upload and execute `F:\浏览器下载\lebanon-260514-free.shp.zip`.
- Symptom: `WORKER_ERROR` with `GeoJSON 解析失败: Error while deserializing JSON: expected value at line 1 column 1`.
- Impact: ZIP Shapefile files could produce metadata but failed during execution/export.
- Files: `src-wasm/src/dispatcher.rs`, `src-wasm/src/metadata.rs`.
- Attempts: Added ZIP detection in execution path and conversion from `.shp/.dbf` entries to a GeoJSON FeatureCollection before applying AST operations.
- Resolution: Fixed by parsing ZIP Shapefile input before AST execution; the Lebanon sample exports 1114 GeoJSON features.
- Next Steps: None.

## BUG-002: fix_encoding normalized to noop

- Status: Fixed
- Date: 2026-05-16
- Scenario: LLM returns `{ "action": "fix_encoding", "from": "...", "to": "utf-8" }`.
- Symptom: AST preview shows `noop` with `不支持或无法归一化的 action: fix_encoding`.
- Impact: Encoding-repair instructions from the LLM are discarded before validation/execution.
- Files: `src/types/ast.ts`, `src/services/astValidation.ts`, `src/services/llmBrain.ts`, `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`.
- Attempts: Added `fix_encoding` to AST types, Zod schema, LLM normalization, Rust operation enum, and dispatcher logging.
- Resolution: Fixed; direct WASM validation executed `fix_encoding` + `export` without normalizing to `noop`.
- Next Steps: None.

## BUG-003: Worker 内嵌套动态导入 WASM 模块失败

- Status: Fixed
- Date: 2026-05-16
- Scenario: 启动 dev server，上传文件触发 Worker 加载真实 Rust WASM 引擎。
- Symptom: `WORKER_ERROR Failed to fetch dynamically imported module: http://127.0.0.1:5173/src-wasm/pkg/geosurgical_wasm.js`。
- Impact: Worker 无法加载真实 WASM 引擎，回退到 Mock 模式；真实 GeoJSON/Shapefile 处理不可用。
- Files: `vite.config.ts`, `src/wasm/geosurgicalRealWasm.ts`, `tsconfig.app.json`。
- Attempts: 分析了 Vite 8 dev 模式下 Worker 内嵌套动态导入的路径解析行为。根因是 Worker 内 `geosurgicalRealWasm.ts` 使用相对路径 `../../src-wasm/pkg/geosurgical_wasm.js` 动态导入 WASM 模块，Vite 8 dev server 未能正确解析 Worker 上下文中的 `../../` 相对路径。
- Resolution: 通过 Vite `resolve.alias` 将 `@wasm/geosurgical` 映射到 `src-wasm/pkg/geosurgical_wasm.js`，避免嵌套相对路径穿越。同步更新 `tsconfig.app.json` 的 `paths` 和 `include` 以支持 TypeScript 类型解析。构建验证通过。
- Next Steps: 用户在浏览器中手动验证文件上传和 WASM 引擎加载。
