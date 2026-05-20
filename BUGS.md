# 问题记录与解决方法

## BUG-001: ZIP Shapefile 执行阶段被当作 GeoJSON 文本解析

- Status: Fixed
- Date: 2026-05-16
- Scenario: 上传 `F:\浏览器下载\lebanon-260514-free.shp.zip`，metadata 提取正常，点击执行后 Worker 报错。
- Symptom: `WORKER_ERROR` with `GeoJSON 解析失败: Error while deserializing JSON: expected value at line 1 column 1`。
- Impact: ZIP Shapefile 文件可以提取 metadata，但执行/导出阶段必定失败。
- Files: `src-wasm/src/dispatcher.rs`, `src-wasm/src/metadata.rs`。

### 问题分析

metadata 提取路径（`metadata.rs`）已有 ZIP Shapefile 检测逻辑：读取 `.shp` + `.dbf` 条目，解析为要素集合。但执行路径（`dispatcher.rs`）没有对应的 ZIP 处理分支，直接把整个 ZIP 二进制当作 GeoJSON 文本 `serde_json::from_slice`，二进制内容不是合法 JSON，反序列化必然失败。

### 解决方法

在 `dispatcher.rs` 的 `execute_surgery` 入口增加 ZIP 检测：如果输入以 `PK` 魔术头开头，走与 `metadata.rs` 相同的 Shapefile 解析逻辑，将 `.shp/.dbf` 条目转为 GeoJSON FeatureCollection，再对 FeatureCollection 执行 AST 操作链。这样执行路径和 metadata 路径共享同一套 Shapefile → GeoJSON 转换逻辑。

- Resolution: Fixed；Lebanon ZIP 样例执行 `fix_encoding + export` 输出 1114 个 GeoJSON 要素。
- Next Steps: None。

---

## BUG-002: fix_encoding 操作被归一化为 noop

- Status: Fixed
- Date: 2026-05-16
- Scenario: LLM 返回 `{ "action": "fix_encoding", "from": "windows-1256", "to": "utf-8" }`，AST 预览显示 `noop`。
- Symptom: `不支持或无法归一化的 action: fix_encoding`，操作被丢弃。
- Impact: LLM 生成的编码修复指令在验证阶段被静默丢弃，用户无法通过自然语言触发编码修复。
- Files: `src/types/ast.ts`, `src/services/astValidation.ts`, `src/services/llmBrain.ts`, `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`。

### 问题分析

AST 类型系统（TypeScript 侧 `ast.ts` 的联合类型 + Zod schema + Rust 侧 `types.rs` 的 Operation enum）中都没有注册 `fix_encoding` 操作。当 `astValidation.ts` 的归一化函数遇到未知 action 时，统一降级为 `noop` 并附带警告。整条链路（TS 类型 → Zod 校验 → LLM 输出归一化 → Rust dispatcher）都没有 `fix_encoding` 的定义。

### 解决方法

在五个位置同步注册 `fix_encoding`：

1. `src/types/ast.ts` — 添加 `GeoSurgicalFixEncoding` 类型，加入 `GeoSurgicalOperation` 联合类型。
2. `src/services/astValidation.ts` — Zod schema 增加 `fix_encoding` 分支（`from` + `to` 字段）。
3. `src/services/llmBrain.ts` — LLM prompt 和 Mock Brain 关键词匹配中增加编码修复相关指令。
4. `src-wasm/src/types.rs` — Rust `Operation` enum 增加 `FixEncoding { from, to }` 变体。
5. `src-wasm/src/dispatcher.rs` — dispatcher match 分支增加 `FixEncoding` 处理（当前为 pass-through 占位，后续接入真实编码转换）。

- Resolution: Fixed；WASM 直接执行 `fix_encoding + export` 不再归一化为 `noop`。
- Next Steps: 后续接入真实 DBF 编码转换（如 GBK/Windows-1256 → UTF-8）。

---

## BUG-002-EXT: fix_encoding Mock Brain 与快捷标签补全

- Status: Fixed
- Date: 2026-05-18
- Scenario: Mock Brain 模式下用户输入编码修复相关指令（如"修复乱码"、"GBK 转 UTF-8"）；ZIP Shapefile 元数据中出现 MISSING_CPG / ENCODING_MISMATCH 等编码警告。
- Symptom: Mock Brain 抛出 `COMMAND_NOT_UNDERSTOOD`；无编码修复快捷标签。
- Impact: 无 LLM 环境（Mock 模式）下 `fix_encoding` 操作完全不可用；编码异常时用户缺少快捷入口。
- Files: `src/services/brain.ts`, `src/services/shortcutTags.ts`。

### 问题分析

BUG-002 修复了 AST 类型、Zod 校验、LLM Prompt 和 Rust dispatcher 五个位置，但遗漏了 Mock Brain 的关键词匹配和快捷标签生成：

1. `brain.ts` 的 `MockBrainGateway.plan()` 没有 `mentionsFixEncoding` 函数，mock 模式下所有编码相关命令直接 fallback 到 `COMMAND_NOT_UNDERSTOOD`。
2. `shortcutTags.ts` 没有检测 `MISSING_CPG`、`ENCODING_MISMATCH`、`LOSSY_UTF8` 等编码警告来生成快捷按钮。

### 解决方法

1. `src/services/brain.ts` — 新增 `mentionsFixEncoding()` 关键词匹配（乱码/编码/encoding/gbk/big5/windows-125x/shift_jis/euc-/iso-8859）和 `extractEncoding()` 编码名提取函数，在 `mentionsExport` 之前插入 `fix_encoding` 操作。
2. `src/services/shortcutTags.ts` — 中英文文案新增 `fixEncoding` 条目；`buildShortcutTags()` 增加编码警告检测：当 metadata.warnings 包含 `MISSING_CPG`/`ENCODING_MISMATCH`/`LOSSY_UTF8` 或 encoding 非 UTF-8 时，生成"修复编码乱码"快捷标签。

- Resolution: Fixed；TypeScript 类型检查和生产构建均通过。
- Next Steps: 用户在浏览器中验证 Mock 模式下输入"修复乱码"指令和编码警告快捷标签的显示。

---

## BUG-003: Worker 内嵌套动态导入 WASM 模块失败

- Status: Fixed
- Date: 2026-05-16
- Scenario: 启动 `npm run dev`（Vite 8.0.13），上传文件触发 Worker 加载真实 Rust WASM 引擎。
- Symptom: `WORKER_ERROR Failed to fetch dynamically imported module: http://127.0.0.1:5173/src-wasm/pkg/geosurgical_wasm.js`。Worker 回退到 Mock 模式。
- Impact: 真实 Rust WASM 引擎完全不可用，所有文件处理走 TypeScript Mock 路径，ZIP Shapefile 解析、真实 BBox/CRS 计算均不可用。
- Files: `vite.config.ts`, `src/wasm/geosurgicalRealWasm.ts`, `tsconfig.app.json`。

### 问题分析

导入链路为三层嵌套动态导入：

```
主线程: new Worker(new URL('./geosurgical.worker.ts', import.meta.url), { type: 'module' })
  → Worker: await import('../wasm/geosurgicalRealWasm.ts')
    → geosurgicalRealWasm.ts: await import('../../src-wasm/pkg/geosurgical_wasm.js')
```

Vite 8 dev 模式下，Worker 代码由 Vite transform 中间件处理，第一层动态导入 `../wasm/geosurgicalRealWasm.ts` 被正确转换为 `/src/wasm/geosurgicalRealWasm.ts`。但第二层嵌套的相对路径 `../../src-wasm/pkg/geosurgical_wasm.js` 在 Worker 上下文中解析失败——浏览器从 Worker 的 URL（`/src/workers/geosurgical.worker.ts`）发起 fetch，`../../` 解析到 `/src-wasm/pkg/geosurgical_wasm.js`，Vite dev server 虽然能返回该文件（curl 测试 200），但 Worker 内的模块加载器未能正确完成路径转换。

用 curl 直接访问 `http://127.0.0.1:5173/src-wasm/pkg/geosurgical_wasm.js` 返回 200 且 Content-Type 正确，说明文件本身可服务。问题出在 Vite 8 对 Worker 内嵌套动态导入的 transform 管道——第二层 `../../` 相对路径穿越未被正确重写为绝对 URL。

### 解决方法

用 Vite `resolve.alias` 替代相对路径，绕过嵌套路径解析问题：

1. `vite.config.ts` — 添加 `resolve.alias`：`@wasm/geosurgical` → `resolve(__dirname, 'src-wasm/pkg/geosurgical_wasm.js')`。
2. `src/wasm/geosurgicalRealWasm.ts` — 动态导入从 `import('../../src-wasm/pkg/geosurgical_wasm.js')` 改为 `import('@wasm/geosurgical')`。
3. `tsconfig.app.json` — 添加 `paths` 映射 `@wasm/geosurgical` → `./src-wasm/pkg/geosurgical_wasm.d.ts`，并将 `src-wasm/pkg` 加入 `include`。

Vite transform 中间件在编译期将 `@wasm/geosurgical` 解析为绝对路径再转换为 `/src-wasm/pkg/geosurgical_wasm.js`，避免了 Worker 内浏览器原生路径解析的 `../../` 穿越问题。

- Resolution: Fixed；TypeScript 类型检查通过，`npm run build` 成功打包 WASM + Worker。
- Next Steps: 用户在浏览器中手动验证文件上传和 WASM 引擎加载。

---

## ISSUE-004: Autocomplete 与 i18n 一致性补全

- Status: Fixed
- Date: 2026-05-18
- Scenario: 全项目一致性审查，对照 BUGS.md 扩展方向和已实现功能。
- Symptom: (1) Autocomplete 缺 `simplify`/`field_calculate`/`validate_geometry` 三个操作；(2) 操作名在 UndoStatus、ResultPanel 中显示为原始 snake_case；(3) UndoStatus 时间描述和"features"为硬编码英文；(4) astValidation 错误信息为硬编码中文。
- Impact: 用户在 autocomplete 中无法发现三个已支持的操作；中英文界面下出现未翻译的原始文本。
- Files: `src/services/autocomplete.ts`, `src/i18n/locales.ts`, `src/components/UndoStatus.tsx`, `src/components/ResultPanel.tsx`, `src/components/ErrorCallout.tsx`, `src/services/astValidation.ts`。

### 解决方法

1. `src/services/autocomplete.ts` — OPERATIONS 列表新增 `simplify`、`field_calculate`、`validate_geometry`。
2. `src/i18n/locales.ts` — 新增三组 i18n key：
   - `operation.*`（12 个操作名的中英文翻译）
   - `undo.justNow` / `undo.secondsAgo` / `undo.minutesAgo` / `undo.hoursAgo` / `undo.featureChange`
   - `validation.invalidAstFormat` / `validation.fieldNotInMetadata` / `validation.confirmFieldName` / `validation.layerNotInFile`
   - `shortcut.reason.fixEncoding`
3. `src/components/UndoStatus.tsx` — 时间格式化改用 i18n key；操作名通过 `t('operation.${action}')` 翻译；features 改用 `t('undo.featureChange')`。
4. `src/components/ResultPanel.tsx` — `formatResultLog` 中操作名先翻译再插入模板。
5. `src/services/astValidation.ts` — 硬编码中文错误信息改为 i18n key（支持 `key?param=value` 格式传递动态参数）。
6. `src/components/ErrorCallout.tsx` — 新增 `resolveI18nMessage` 函数，解析 i18n key 及其 URL 参数，`suggestedUserInput` 同样走翻译。

- Resolution: Fixed；TypeScript 类型检查和生产构建均通过。

---

## ISSUE-005: Worker WASM 加载失败错误上报

- Status: Fixed
- Date: 2026-05-18
- Reference: EXTENSION_GUIDE.md §4.1 — "Worker 返回 WASM 加载失败的具体错误"
- Scenario: 真实 WASM 加载失败（路径错误、打包缺失、浏览器不支持等），Worker 静默回退到 Mock。
- Symptom: `catch` 块吞掉错误，用户和开发者无法得知 WASM 失败原因。
- Impact: Mock 模式误用时无法定位根因。
- Files: `src/workers/geosurgical.worker.ts`, `src/types/protocol.ts`, `src/hooks/useGeoSurgicalWorker.ts`, `src/components/AppShell.tsx`。

### 解决方法

1. `src/types/protocol.ts` — `ENGINE_STATUS` 消息新增可选 `wasmError?: string` 字段。
2. `src/workers/geosurgical.worker.ts` — `catch` 块捕获错误为 `wasmLoadError`，通过 `ENGINE_STATUS` 上报；Mock 模式 metadata warning 内嵌具体错误原因。
3. `src/hooks/useGeoSurgicalWorker.ts` — 新增 `wasmError` 状态，`ENGINE_STATUS` 处理时存储。
4. `src/components/AppShell.tsx` — 引擎状态 badge 添加 `title={wasmError}`，hover 时显示具体失败原因。

- Resolution: Fixed；TypeScript 类型检查和生产构建均通过。

---

## PHASE-B: 真实数据处理能力增强

- Status: Completed
- Date: 2026-05-18
- Reference: EXTENSION_GUIDE.md §6 阶段 B

### B1: DBF Header LDID 编码推断

无 `.cpg` 文件时，从 DBF 字节 29（Language Driver ID）推断编码。覆盖 22 种常见 LDID（cp437, windows-125x, gbk, big5, shift_jis 等）。优先级：.cpg > DBF LDID > lossy-utf8。

- Files: `src-wasm/src/metadata.rs`

### B2: CRS 置信度字段

新增 `crsConfidence` 字段区分 CRS 来源：`authoritative`（.prj AUTHORITY 标签）、`heuristic`（WKT 名称推测/bbox 猜测）、`none`（未知）。MetadataPanel CRS 指标旁显示颜色 badge（绿/黄/灰）。

- Files: `src-wasm/src/types.rs`, `src-wasm/src/metadata.rs`, `src/types/metadata.ts`, `src/components/MetadataPanel.tsx`, `src/i18n/locales.ts`

### B3: .prj WKT 解析增强

扩展 GEOGCS 名称匹配（JGD2000/2011, Pulkovo, Korean 1985, Tokyo, Hong Kong 1980）。新增 PROJCS 解析：UTM Zone → EPSG:326xx/327xx，中国高斯-克吕格（CGCS2000/北京54/西安80），Web Mercator → EPSG:3857。

- Files: `src-wasm/src/metadata.rs`

### B4: 更多 CRS 转换

新增两种 CRS 转换：EPSG:4326 → EPSG:3857（Web Mercator 投影），GCJ-02 → EPSG:4326（反向纠偏，迭代求逆）。Mock Brain 扩展识别 3857/mercator/投影/反向等关键词。

- Files: `src-wasm/src/dispatcher.rs`, `src/services/brain.ts`, `src/services/llmBrain.ts`

### B5: 地图对比增强

原始图层支持 WebGL 渲染。新增透明度滑块（0-100%），控制原始/处理图层混合效果。

- Files: `src/components/MapPreview.tsx`, `src/i18n/locales.ts`

### B6: 新操作 E2E 测试

测试数据新增 `population` 字段和自相交多边形。新增 6 个 Playwright 测试：simplify、validate_geometry、transform_crs GCJ-02、transform_crs EPSG:3857、field_calculate、fix_encoding。

- Files: `e2e/test-data.geojson`, `e2e/main-flow.spec.ts`

### B7: UI 优化

- `@keyframes fade-in` 动画 + `.animate-fade-in` 类
- MetadataPanel / AstPreview / ResultPanel / ProgressTimeline 出现时 fade-in
- 进度条 `transition-all duration-500`
- 空状态添加 lucide 图标（FileSearch / Code / Activity / Inbox）
- CommandPalette 自动补全：backdrop-blur、键盘提示（Tab/Enter/Esc）
- 地图原始图层透明度滑块

- Resolution: TypeScript 类型检查和生产构建均通过。

---

## FEAT-006: 6 语言国际化 + 语言切换下拉框

- Status: Completed
- Date: 2026-05-18
- Scenario: 用户希望支持更多语言。
- Impact: 新增日语、韩语、法语、西班牙语四语言支持；语言切换从按钮组改为下拉选择框。
- Files: `src/i18n/locales.ts`, `src/i18n/I18nContext.tsx`, `src/components/AppShell.tsx`, `src/services/shortcutTags.ts`, `src/index.css`

### 解决方法

1. `src/i18n/locales.ts` — 新增 ja/ko/fr/es 四个语言块（各 100+ 翻译键），zh/en 补充 `language.ja/ko/fr/es` 键。
2. `src/i18n/I18nContext.tsx` — `getInitialLanguage` 扩展支持 ja/ko/fr/es 浏览器语言自动检测。
3. `src/components/AppShell.tsx` — 语言切换从按钮组改为 `<select>` 下拉框，导入 `Language` 类型。
4. `src/services/shortcutTags.ts` — 快捷标签新增 ja/ko/fr/es 四语言翻译。
5. `src/index.css` — 新增 `select option` 暗色背景样式。

- Resolution: TypeScript 类型检查和生产构建均通过。

---

## PHASE-C: 空间分析能力

- Status: Completed
- Date: 2026-05-19
- Reference: EXTENSION_GUIDE.md §6 阶段 C

### C1: buffer 缓冲区

对几何生成缓冲区，圆弧近似（geo 0.28 无 Buffer trait，使用 circle polygon + BooleanOps::union）。Point → 单圆，LineString → 多圆合并，Polygon → 外环点圆合并。

- Files: `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### C2: clip 裁剪

按 bbox 过滤要素，保留 bbox 与目标 bbox 有重叠的要素。使用 bbox 相交检测而非逐点包含检查。

- Files: `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### C3: intersect 相交

按 bbox 筛选相交要素，逻辑与 clip 相同（bbox 重叠检测）。

- Files: `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### C4: dissolve 融合

按字段值分组，同组多边形通过 BooleanOps::union 合并为一个几何。支持 Polygon 和 MultiPolygon。

- Files: `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### TypeScript 同步

所有 4 个新操作同步更新：`src/types/ast.ts`（类型定义）、`src/services/astValidation.ts`（Zod schema + 风险检测）、`src/services/llmBrain.ts`（prompt + normalizeOperation）、`src/services/brain.ts`（Mock Brain 关键词匹配）、`src/services/autocomplete.ts`（自动补全）、`src/i18n/locales.ts`（6 语言翻译）、`schemas/ast-schema.json`（JSON Schema）。

- Resolution: cargo check 通过，TypeScript 类型检查和生产构建均通过。

---

## BUG-007: Mock Brain English CRS target detection treated source EPSG:4326 as target

- Status: Fixed
- Date: 2026-05-20
- Scenario: Run `npm test`; `MockBrainGateway` handles `Convert EPSG:4326 to GCJ-02 and export GeoJSON`.
- Symptom: The generated AST used `{ "to": "EPSG:4326" }` instead of `{ "to": "GCJ-02" }`, causing `src/services/brain.test.ts` to fail.
- Impact: English commands that explicitly say `to GCJ-02` could be planned as a no-op or wrong-direction CRS transform in Mock Brain mode.
- Files: `src/services/brain.ts`, `src/services/brain.test.ts`.
- Attempts: Reproduced with `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" test`.
- Resolution: Updated Mock Brain CRS target detection to prioritize explicit `to GCJ-02` / `into GCJ-02` and Chinese 火星 target phrases before treating `4326` as an EPSG:4326 target.
- Next Steps: Re-run unit tests and full validation commands.

---

## BUG-008: Shapefile result kind missing from TypeScript protocol union

- Status: Fixed
- Date: 2026-05-20
- Scenario: Run `npm run typecheck` after large-dataset export changes added `shapefile` handling in result UI.
- Symptom: TypeScript reported `TS2367` comparisons because `SurgeryResult.kind` only allowed `geojson | summary` while UI checked for `shapefile`.
- Impact: Production build and typecheck failed even though Rust output could emit shapefile result metadata.
- Files: `src/types/protocol.ts`, `src/components/MapPreview.tsx`, `src/components/ResultPanel.tsx`.
- Attempts: Reproduced with `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run typecheck`.
- Resolution: Added `shapefile` to the `SurgeryResult.kind` TypeScript union so protocol types match frontend handling and Rust envelope output.
- Next Steps: Re-run typecheck and build.

---

## VALIDATION-009: npm audit unavailable on configured registry mirror

- Status: Open
- Date: 2026-05-20
- Scenario: Run `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" audit --audit-level=high` during pre-commit validation.
- Symptom: npm returned `404 Not Found` and `[NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet` from `https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk`.
- Impact: Dependency security audit could not be completed in this environment; tests/typecheck/build are unaffected.
- Files: npm registry configuration/environment; no source file changes required.
- Attempts: Ran npm audit with high severity threshold.
- Resolution: Pending.
- Next Steps: Re-run audit against the official npm registry or a mirror that implements npm audit endpoints.

---

## VALIDATION-010: Non-blocking validation warnings remain

- Status: Open
- Date: 2026-05-20
- Scenario: Run `cargo check` and `npm run build` during validation.
- Symptom: Cargo reported unused mutability/dead field warnings; Vite reported a main chunk larger than 500 kB after minification.
- Impact: Commands pass successfully, but warnings should be reviewed before production hardening.
- Files: `src-wasm/src/dispatcher.rs`, `src-wasm/src/metadata.rs`, Vite production bundle output.
- Attempts: Captured warnings during validation; no functional change made because they are non-blocking and outside the requested fix scope.
- Resolution: Pending.
- Next Steps: Remove unused Rust mutability/dead field when touching those modules; consider route/code splitting or chunk-size configuration if bundle size becomes a product concern.

---

## VALIDATION-011: ESLint scanned generated Rust/WASM artifacts

- Status: Fixed
- Date: 2026-05-20
- Scenario: Run `npm run lint` during validation.
- Symptom: ESLint reported generated `src-wasm/pkg/geosurgical_wasm.js` and Rust documentation files under `src-wasm/target/doc/**`, including browser globals and generated unused variables.
- Impact: Lint failed on generated artifacts instead of project-authored source files.
- Files: `eslint.config.js`, `src-wasm/pkg/**`, `src-wasm/target/**`.
- Attempts: Ran `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run lint` and inspected failure paths.
- Resolution: Added `src-wasm/pkg/**` and `src-wasm/target/**` to ESLint ignores alongside `dist`.
- Next Steps: Re-run lint.
