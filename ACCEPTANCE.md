# Acceptance Criteria

## MVP Scope

- [x] ZIP Shapefile 文件不会在执行阶段被当作 GeoJSON 文本解析。
- [x] `fix_encoding` 是合法 GeoSurgical AST 操作，不会被归一化为 `noop`。
- [x] 用户提供的 `F:\浏览器下载\lebanon-260514-free.shp.zip` 可以完成 metadata 提取和执行导出验证。
- [x] Worker 内 WASM 模块动态导入路径在 Vite 8 dev server 中正确解析。

## Out of Scope

- 完整 DBF 编码自动识别。
- 完整 PROJ 坐标系转换引擎。
- Shapefile Multipatch 几何导出。

## Validation

- [x] Rust WASM 构建通过。
- [x] TypeScript 构建通过。
- [x] 单元测试通过。
- [x] Vite build 通过（含 WASM 和 Worker 打包）。
- [x] 使用 Lebanon ZIP 样例完成本地验证。

## Result

- Status: Passed
- Verified commands:
  - `npm run typecheck`
  - `wasm-pack build "C:\Users\hhn\Desktop\frontend\React\webGis\src-wasm" --target web --release`
  - `npm run test`
  - `npm run build`
  - Direct WASM Node validation using `F:\浏览器下载\lebanon-260514-free.shp.zip`
- Known Issues:
  - BUG-003 需用户在浏览器中手动验证 WASM 引擎加载；见 `BUGS.md`。
- Notes:
  - Lebanon ZIP metadata extraction returned `shapefile_zip`, 1114 features, 5 fields, and `LOSSY_DBF_DECODE` warning.
  - Lebanon ZIP execution with `fix_encoding` + `export` returned GeoJSON with 1114 output features and operations `["fix_encoding", "export"]`.
  - BUG-003 修复：Vite `resolve.alias` 替代嵌套相对路径，TypeScript 和构建均通过。
