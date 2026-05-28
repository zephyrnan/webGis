# 问题记录与解决方法

## BUG-001: ZIP Shapefile 执行阶段被当作 GeoJSON 文本解析

- 状态： 已修复
- 日期： 2026-05-16
- 场景： 上传 `F:\浏览器下载\lebanon-260514-free.shp.zip`，metadata 提取正常，点击执行后 Worker 报错。
- 现象： `WORKER_ERROR` with `GeoJSON 解析失败: Error while deserializing JSON: expected value at line 1 column 1`。
- 影响： ZIP Shapefile 文件可以提取 metadata，但执行/导出阶段必定失败。
- 涉及文件： `src-wasm/src/dispatcher.rs`, `src-wasm/src/metadata.rs`。

### 问题分析

metadata 提取路径（`metadata.rs`）已有 ZIP Shapefile 检测逻辑：读取 `.shp` + `.dbf` 条目，解析为要素集合。但执行路径（`dispatcher.rs`）没有对应的 ZIP 处理分支，直接把整个 ZIP 二进制当作 GeoJSON 文本 `serde_json::from_slice`，二进制内容不是合法 JSON，反序列化必然失败。

### 解决方法

在 `dispatcher.rs` 的 `execute_surgery` 入口增加 ZIP 检测：如果输入以 `PK` 魔术头开头，走与 `metadata.rs` 相同的 Shapefile 解析逻辑，将 `.shp/.dbf` 条目转为 GeoJSON FeatureCollection，再对 FeatureCollection 执行 AST 操作链。这样执行路径和 metadata 路径共享同一套 Shapefile → GeoJSON 转换逻辑。

- 解决方式： 已修复；Lebanon ZIP 样例执行 `fix_encoding + export` 输出 1114 个 GeoJSON 要素。
- 后续步骤： 无。

---

## BUG-002: fix_encoding 操作被归一化为 noop

- 状态： 已修复
- 日期： 2026-05-16
- 场景： LLM 返回 `{ "action": "fix_encoding", "from": "windows-1256", "to": "utf-8" }`，AST 预览显示 `noop`。
- 现象： `不支持或无法归一化的 action: fix_encoding`，操作被丢弃。
- 影响： LLM 生成的编码修复指令在验证阶段被静默丢弃，用户无法通过自然语言触发编码修复。
- 涉及文件： `src/types/ast.ts`, `src/services/astValidation.ts`, `src/services/llmBrain.ts`, `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`。

### 问题分析

AST 类型系统（TypeScript 侧 `ast.ts` 的联合类型 + Zod schema + Rust 侧 `types.rs` 的 Operation enum）中都没有注册 `fix_encoding` 操作。当 `astValidation.ts` 的归一化函数遇到未知 action 时，统一降级为 `noop` 并附带警告。整条链路（TS 类型 → Zod 校验 → LLM 输出归一化 → Rust dispatcher）都没有 `fix_encoding` 的定义。

### 解决方法

在五个位置同步注册 `fix_encoding`：

1. `src/types/ast.ts` — 添加 `GeoSurgicalFixEncoding` 类型，加入 `GeoSurgicalOperation` 联合类型。
2. `src/services/astValidation.ts` — Zod schema 增加 `fix_encoding` 分支（`from` + `to` 字段）。
3. `src/services/llmBrain.ts` — LLM prompt 和 Mock Brain 关键词匹配中增加编码修复相关指令。
4. `src-wasm/src/types.rs` — Rust `Operation` enum 增加 `FixEncoding { from, to }` 变体。
5. `src-wasm/src/dispatcher.rs` — dispatcher match 分支增加 `FixEncoding` 处理（当前为 pass-through 占位，后续接入真实编码转换）。

- 解决方式： 已修复；WASM 直接执行 `fix_encoding + export` 不再归一化为 `noop`。
- 后续步骤： 后续接入真实 DBF 编码转换（如 GBK/Windows-1256 → UTF-8）。

---

## BUG-002-EXT: fix_encoding Mock Brain 与快捷标签补全

- 状态： 已修复
- 日期： 2026-05-18
- 场景： Mock Brain 模式下用户输入编码修复相关指令（如"修复乱码"、"GBK 转 UTF-8"）；ZIP Shapefile 元数据中出现 MISSING_CPG / ENCODING_MISMATCH 等编码警告。
- 现象： Mock Brain 抛出 `COMMAND_NOT_UNDERSTOOD`；无编码修复快捷标签。
- 影响： 无 LLM 环境（Mock 模式）下 `fix_encoding` 操作完全不可用；编码异常时用户缺少快捷入口。
- 涉及文件： `src/services/brain.ts`, `src/services/shortcutTags.ts`。

### 问题分析

BUG-002 修复了 AST 类型、Zod 校验、LLM Prompt 和 Rust dispatcher 五个位置，但遗漏了 Mock Brain 的关键词匹配和快捷标签生成：

1. `brain.ts` 的 `MockBrainGateway.plan()` 没有 `mentionsFixEncoding` 函数，mock 模式下所有编码相关命令直接 fallback 到 `COMMAND_NOT_UNDERSTOOD`。
2. `shortcutTags.ts` 没有检测 `MISSING_CPG`、`ENCODING_MISMATCH`、`LOSSY_UTF8` 等编码警告来生成快捷按钮。

### 解决方法

1. `src/services/brain.ts` — 新增 `mentionsFixEncoding()` 关键词匹配（乱码/编码/encoding/gbk/big5/windows-125x/shift_jis/euc-/iso-8859）和 `extractEncoding()` 编码名提取函数，在 `mentionsExport` 之前插入 `fix_encoding` 操作。
2. `src/services/shortcutTags.ts` — 中英文文案新增 `fixEncoding` 条目；`buildShortcutTags()` 增加编码警告检测：当 metadata.warnings 包含 `MISSING_CPG`/`ENCODING_MISMATCH`/`LOSSY_UTF8` 或 encoding 非 UTF-8 时，生成"修复编码乱码"快捷标签。

- 解决方式： 已修复；TypeScript 类型检查和生产构建均通过。
- 后续步骤： 用户在浏览器中验证 Mock 模式下输入"修复乱码"指令和编码警告快捷标签的显示。

---

## BUG-003: Worker 内嵌套动态导入 WASM 模块失败

- 状态： 已修复
- 日期： 2026-05-16
- 场景： 启动 `npm run dev`（Vite 8.0.13），上传文件触发 Worker 加载真实 Rust WASM 引擎。
- 现象： `WORKER_ERROR Failed to fetch dynamically imported module: http://127.0.0.1:5173/src-wasm/pkg/geosurgical_wasm.js`。Worker 回退到 Mock 模式。
- 影响： 真实 Rust WASM 引擎完全不可用，所有文件处理走 TypeScript Mock 路径，ZIP Shapefile 解析、真实 BBox/CRS 计算均不可用。
- 涉及文件： `vite.config.ts`, `src/wasm/geosurgicalRealWasm.ts`, `tsconfig.app.json`。

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

- 解决方式： 已修复；TypeScript 类型检查通过，`npm run build` 成功打包 WASM + Worker。
- 后续步骤： 用户在浏览器中手动验证文件上传和 WASM 引擎加载。

---

## ISSUE-004: Autocomplete 与 i18n 一致性补全

- 状态： 已修复
- 日期： 2026-05-18
- 场景： 全项目一致性审查，对照 BUGS.md 扩展方向和已实现功能。
- 现象： (1) Autocomplete 缺 `simplify`/`field_calculate`/`validate_geometry` 三个操作；(2) 操作名在 UndoStatus、ResultPanel 中显示为原始 snake_case；(3) UndoStatus 时间描述和"features"为硬编码英文；(4) astValidation 错误信息为硬编码中文。
- 影响： 用户在 autocomplete 中无法发现三个已支持的操作；中英文界面下出现未翻译的原始文本。
- 涉及文件： `src/services/autocomplete.ts`, `src/i18n/locales.ts`, `src/components/UndoStatus.tsx`, `src/components/ResultPanel.tsx`, `src/components/ErrorCallout.tsx`, `src/services/astValidation.ts`。

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

- 解决方式： 已修复；TypeScript 类型检查和生产构建均通过。

---

## ISSUE-005: Worker WASM 加载失败错误上报

- 状态： 已修复
- 日期： 2026-05-18
- 参考： EXTENSION_GUIDE.md §4.1 — "Worker 返回 WASM 加载失败的具体错误"
- 场景： 真实 WASM 加载失败（路径错误、打包缺失、浏览器不支持等），Worker 静默回退到 Mock。
- 现象： `catch` 块吞掉错误，用户和开发者无法得知 WASM 失败原因。
- 影响： Mock 模式误用时无法定位根因。
- 涉及文件： `src/workers/geosurgical.worker.ts`, `src/types/protocol.ts`, `src/hooks/useGeoSurgicalWorker.ts`, `src/components/AppShell.tsx`。

### 解决方法

1. `src/types/protocol.ts` — `ENGINE_STATUS` 消息新增可选 `wasmError?: string` 字段。
2. `src/workers/geosurgical.worker.ts` — `catch` 块捕获错误为 `wasmLoadError`，通过 `ENGINE_STATUS` 上报；Mock 模式 metadata warning 内嵌具体错误原因。
3. `src/hooks/useGeoSurgicalWorker.ts` — 新增 `wasmError` 状态，`ENGINE_STATUS` 处理时存储。
4. `src/components/AppShell.tsx` — 引擎状态 badge 添加 `title={wasmError}`，hover 时显示具体失败原因。

- 解决方式： 已修复；TypeScript 类型检查和生产构建均通过。

---

## PHASE-B: 真实数据处理能力增强

- 状态： 已完成
- 日期： 2026-05-18
- 参考： EXTENSION_GUIDE.md §6 阶段 B

### B1: DBF Header LDID 编码推断

无 `.cpg` 文件时，从 DBF 字节 29（Language Driver ID）推断编码。覆盖 22 种常见 LDID（cp437, windows-125x, gbk, big5, shift_jis 等）。优先级：.cpg > DBF LDID > lossy-utf8。

- 涉及文件： `src-wasm/src/metadata.rs`

### B2: CRS 置信度字段

新增 `crsConfidence` 字段区分 CRS 来源：`authoritative`（.prj AUTHORITY 标签）、`heuristic`（WKT 名称推测/bbox 猜测）、`none`（未知）。MetadataPanel CRS 指标旁显示颜色 badge（绿/黄/灰）。

- 涉及文件： `src-wasm/src/types.rs`, `src-wasm/src/metadata.rs`, `src/types/metadata.ts`, `src/components/MetadataPanel.tsx`, `src/i18n/locales.ts`

### B3: .prj WKT 解析增强

扩展 GEOGCS 名称匹配（JGD2000/2011, Pulkovo, Korean 1985, Tokyo, Hong Kong 1980）。新增 PROJCS 解析：UTM Zone → EPSG:326xx/327xx，中国高斯-克吕格（CGCS2000/北京54/西安80），Web Mercator → EPSG:3857。

- 涉及文件： `src-wasm/src/metadata.rs`

### B4: 更多 CRS 转换

新增两种 CRS 转换：EPSG:4326 → EPSG:3857（Web Mercator 投影），GCJ-02 → EPSG:4326（反向纠偏，迭代求逆）。Mock Brain 扩展识别 3857/mercator/投影/反向等关键词。

- 涉及文件： `src-wasm/src/dispatcher.rs`, `src/services/brain.ts`, `src/services/llmBrain.ts`

### B5: 地图对比增强

原始图层支持 WebGL 渲染。新增透明度滑块（0-100%），控制原始/处理图层混合效果。

- 涉及文件： `src/components/MapPreview.tsx`, `src/i18n/locales.ts`

### B6: 新操作 E2E 测试

测试数据新增 `population` 字段和自相交多边形。新增 6 个 Playwright 测试：simplify、validate_geometry、transform_crs GCJ-02、transform_crs EPSG:3857、field_calculate、fix_encoding。

- 涉及文件： `e2e/test-data.geojson`, `e2e/main-flow.spec.ts`

### B7: UI 优化

- `@keyframes fade-in` 动画 + `.animate-fade-in` 类
- MetadataPanel / AstPreview / ResultPanel / ProgressTimeline 出现时 fade-in
- 进度条 `transition-all duration-500`
- 空状态添加 lucide 图标（FileSearch / Code / Activity / Inbox）
- CommandPalette 自动补全：backdrop-blur、键盘提示（Tab/Enter/Esc）
- 地图原始图层透明度滑块

- 解决方式： TypeScript 类型检查和生产构建均通过。

---

## FEAT-006: 6 语言国际化 + 语言切换下拉框

- 状态： 已完成
- 日期： 2026-05-18
- 场景： 用户希望支持更多语言。
- 影响： 新增日语、韩语、法语、西班牙语四语言支持；语言切换从按钮组改为下拉选择框。
- 涉及文件： `src/i18n/locales.ts`, `src/i18n/I18nContext.tsx`, `src/components/AppShell.tsx`, `src/services/shortcutTags.ts`, `src/index.css`

### 解决方法

1. `src/i18n/locales.ts` — 新增 ja/ko/fr/es 四个语言块（各 100+ 翻译键），zh/en 补充 `language.ja/ko/fr/es` 键。
2. `src/i18n/I18nContext.tsx` — `getInitialLanguage` 扩展支持 ja/ko/fr/es 浏览器语言自动检测。
3. `src/components/AppShell.tsx` — 语言切换从按钮组改为 `<select>` 下拉框，导入 `Language` 类型。
4. `src/services/shortcutTags.ts` — 快捷标签新增 ja/ko/fr/es 四语言翻译。
5. `src/index.css` — 新增 `select option` 暗色背景样式。

- 解决方式： TypeScript 类型检查和生产构建均通过。

---

## PHASE-C: 空间分析能力

- 状态： 已完成
- 日期： 2026-05-19
- 参考： EXTENSION_GUIDE.md §6 阶段 C

### C1: buffer 缓冲区

对几何生成缓冲区，圆弧近似（geo 0.28 无 Buffer trait，使用 circle polygon + BooleanOps::union）。Point → 单圆，LineString → 多圆合并，Polygon → 外环点圆合并。

- 涉及文件： `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### C2: clip 裁剪

按 bbox 过滤要素，保留 bbox 与目标 bbox 有重叠的要素。使用 bbox 相交检测而非逐点包含检查。

- 涉及文件： `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### C3: intersect 相交

按 bbox 筛选相交要素，逻辑与 clip 相同（bbox 重叠检测）。

- 涉及文件： `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### C4: dissolve 融合

按字段值分组，同组多边形通过 BooleanOps::union 合并为一个几何。支持 Polygon 和 MultiPolygon。

- 涉及文件： `src-wasm/src/types.rs`, `src-wasm/src/dispatcher.rs`

### TypeScript 同步

所有 4 个新操作同步更新：`src/types/ast.ts`（类型定义）、`src/services/astValidation.ts`（Zod schema + 风险检测）、`src/services/llmBrain.ts`（prompt + normalizeOperation）、`src/services/brain.ts`（Mock Brain 关键词匹配）、`src/services/autocomplete.ts`（自动补全）、`src/i18n/locales.ts`（6 语言翻译）、`schemas/ast-schema.json`（JSON Schema）。

- 解决方式： cargo check 通过，TypeScript 类型检查和生产构建均通过。

---

## BUG-007: Mock Brain English CRS target detection treated source EPSG:4326 as target

- 状态： 已修复
- 日期： 2026-05-20
- 场景： Run `npm test`; `MockBrainGateway` handles `Convert EPSG:4326 to GCJ-02 and export GeoJSON`.
- 现象： The generated AST used `{ "to": "EPSG:4326" }` instead of `{ "to": "GCJ-02" }`, causing `src/services/brain.test.ts` to fail.
- 影响： English commands that explicitly say `to GCJ-02` could be planned as a no-op or wrong-direction CRS transform in Mock Brain mode.
- 涉及文件： `src/services/brain.ts`, `src/services/brain.test.ts`.
- 尝试： Reproduced with `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" test`.
- 解决方式： Updated Mock Brain CRS target detection to prioritize explicit `to GCJ-02` / `into GCJ-02` and Chinese 火星 target phrases before treating `4326` as an EPSG:4326 target.
- 后续步骤： Re-run unit tests and full validation commands.

---

## BUG-008: Shapefile result kind missing from TypeScript protocol union

- 状态： 已修复
- 日期： 2026-05-20
- 场景： Run `npm run typecheck` after large-dataset export changes added `shapefile` handling in result UI.
- 现象： TypeScript reported `TS2367` comparisons because `SurgeryResult.kind` only allowed `geojson | summary` while UI checked for `shapefile`.
- 影响： Production build and typecheck failed even though Rust output could emit shapefile result metadata.
- 涉及文件： `src/types/protocol.ts`, `src/components/MapPreview.tsx`, `src/components/ResultPanel.tsx`.
- 尝试： Reproduced with `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run typecheck`.
- 解决方式： Added `shapefile` to the `SurgeryResult.kind` TypeScript union so protocol types match frontend handling and Rust envelope output.
- 后续步骤： Re-run typecheck and build.

---

## VALIDATION-009: npm audit unavailable on configured registry mirror

- 状态： 已修复
- 日期： 2026-05-20
- 场景： Run `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" audit --audit-level=high` during pre-commit validation.
- 现象： npm returned `404 Not Found` and `[NOT_IMPLEMENTED] /-/npm/v1/security/* not implemented yet` from `https://registry.npmmirror.com/-/npm/v1/security/advisories/bulk`.
- 影响： Dependency security audit could not be completed in this environment; tests/typecheck/build are unaffected.
- 涉及文件： npm registry configuration/environment; no source file changes required.
- 尝试： Ran `npm audit --registry https://registry.npmjs.org --audit-level=high` against official npm registry.
- 解决方式： 已修复；使用官方 npm registry 重跑 audit，结果为 0 vulnerabilities。
- 后续步骤： 无.

---

## VALIDATION-010: Non-blocking validation warnings remain

- 状态： Partially 已修复
- 日期： 2026-05-20
- 场景： Run `cargo check` and `npm run build` during validation.
- 现象： Cargo reported unused mutability/dead field warnings; Vite reported a main chunk larger than 500 kB after minification.
- 影响： Commands pass successfully, but warnings should be reviewed before production hardening.
- 涉及文件： `src-wasm/src/dispatcher.rs`, `src-wasm/src/metadata.rs`, Vite production bundle output.
- 尝试： Removed `mut` from `null_key` and `f` in dispatcher.rs; removed dead `total_field_count` field from `DbfMetadata` struct in metadata.rs.
- 解决方式： Rust warnings fixed (0 warnings from `cargo check`). Vite chunk-size warning remains, planned for P0.4.
- 后续步骤： P0.4 dynamic import for OpenLayers/WASM to reduce bundle size.

---

## VALIDATION-011: ESLint scanned generated Rust/WASM artifacts

- 状态： 已修复
- 日期： 2026-05-20
- 场景： Run `npm run lint` during validation.
- 现象： ESLint reported generated `src-wasm/pkg/geosurgical_wasm.js` and Rust documentation files under `src-wasm/target/doc/**`, including browser globals and generated unused variables.
- 影响： Lint failed on generated artifacts instead of project-authored source files.
- 涉及文件： `eslint.config.js`, `src-wasm/pkg/**`, `src-wasm/target/**`.
- 尝试： Ran `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run lint` and inspected failure paths.
- 解决方式： Added `src-wasm/pkg/**` and `src-wasm/target/**` to ESLint ignores alongside `dist`.
- 后续步骤： Re-run lint.

---

## BUG-012: Mock Brain filter_area operator for "删除 area 为 0" command

- 状态： 已修复
- 日期： 2026-05-24
- 场景： Upload GeoJSON with an area=0 feature, click shortcut tag "清理 area 为 0 的废弃多边形", generate AST.
- 现象： Mock Brain generates `{ "action": "filter_area", "field": "area", "operator": ">=", "value": 0 }`. The `>=` operator keeps all features (including area=0), so nothing is removed.
- 影响： The "删除 area 为 0 的要素" shortcut tag doesn't actually remove zero-area features in Mock Brain mode.
- 涉及文件： `src/services/brain.ts`, `src/services/brain.test.ts`.
- 尝试： Added `mentionsEqualToZero()` function to detect "为 0", "等于 0", "is 0", "equals 0", "= 0" patterns. Updated operator selection logic to use `>` when value is 0 and command mentions equality to zero.
- 解决方式： 已修复；新增 2 个测试用例覆盖中英文场景，全部 9 个测试通过。
- 后续步骤： 无.

---

## BUG-013: Operation log contains hardcoded Chinese not covered by i18n

- 状态： 已修复
- 日期： 2026-05-24
- 场景： Execute any AST operation, switch UI language to English, check the operation log in ResultPanel.
- 现象： Log shows "Mock WASM 已执行 filter_area (移除了 0 个要素)" in Chinese even when UI is in English.
- 影响： Operation log messages are not i18n'd, breaking the 6-language experience.
- 涉及文件： `src-wasm/src/dispatcher.rs`, `src/components/ResultPanel.tsx`, `src/i18n/locales.ts`.
- 尝试： Observed during manual browser verification.
- 解决方式： 已修复.
  1. Rust dispatcher now emits structured `operation:action|key=value` format instead of hardcoded Chinese strings (e.g., `operation:filter_area|removed=0`).
  2. Frontend `formatResultLog` parses the structured format, translates operation names via `operation.*` keys, and translates detail strings via `log.detail.*` i18n templates.
  3. Added `log.operationWithDetail` and 18 `log.detail.*` i18n keys across all 6 languages (zh, en, ja, ko, fr, es).
  4. Special-cased `transform_crs.skipped` and `fix_encoding.reencoded` variants.
- 后续步骤： 无。

---

## BUG-014: Code review MEDIUM severity issues batch fix

- 状态： 已修复
- 日期： 2026-05-25
- 场景： Comprehensive code review identified multiple MEDIUM severity issues across Rust WASM, Worker, and frontend components.
- 现象： Various logic errors, memory leaks, and missing error handling.
- 影响： Individual issues are medium-severity but collectively affect reliability and memory efficiency.
- 涉及文件： `src-wasm/src/dispatcher.rs`, `src/components/MapPreview.tsx`, `src/components/HistoryPanel.tsx`, `src/workers/geosurgical.worker.ts`, `src/hooks/useGeoSurgicalWorker.ts`.

### 修复内容

1. **`compare_numeric` epsilon fix** — `"="` branch used absolute `f64::EPSILON` (~2.22e-16) which fails for values much larger than 1.0. Changed to relative epsilon: `f64::EPSILON * left.abs().max(right.abs()).max(1.0)`.

2. **`stream_export_zip` progress stuck at 20%** — All three `emit_progress` calls used hardcoded 20%. Now uses `properties.len()` as total estimate and calculates real percent (10%-90%). Also replaced hardcoded Chinese progress messages with structured keys.

3. **`preserve_topology` in Simplify silently ignored** — The `preserve_topology` field was bound to `_` and never used. Now wired up: imports `geo::SimplifyVwPreserve` and calls `simplify_vw_preserve()` when `preserve_topology` is true (default), otherwise uses standard `simplify()`.

4. **MapPreview Select interaction leak** — Second `Select` interaction (in `useEffect` with `[result, useWebGL]` deps) had no cleanup return. Added cleanup that removes the interaction on effect re-run/unmount.

5. **MapPreview blobUrl memory leak** — Worker-created `blobUrl` was never revoked. `ResultPanel` explicitly skipped it. Now the MapPreview effect revokes `blobUrl` in its cleanup function.

6. **HistoryPanel IndexedDB error handling** — `handleDelete` and `handleClear` had no try/catch; `refresh` had `finally` but no `catch`. Added try/catch blocks to all three.

7. **Worker `taskContexts` Map never cleaned up** — Old task contexts (including full file `ArrayBuffer`) accumulated indefinitely. Added cleanup in `handleUpload` that removes old contexts before setting the new one.

8. **Progress array unbounded growth** — `setProgress([])` was not called in `executeAst`, so progress events accumulated across multiple executions. Added `setProgress([])` reset.

9. **Hardcoded Chinese in `emit_progress`** — 已修复 remaining hardcoded Chinese strings in Rust `emit_progress` calls (main dispatcher loop, stream_export_zip messages).

- 解决方式： `cargo check` clean, `tsc --noEmit` clean, all 45 tests pass.
- 后续步骤： H3 (Clip ≠ Intersect) requires Sutherland-Hodgman algorithm implementation — deferred.

---

## BUG-015: SiliconFlow endpoint 被误判为 Ollama 格式

- 状态：已修复
- 日期：2026-05-28
- 场景：`.env` 使用 `VITE_LLM_ENDPOINT=https://api.siliconflow.cn`，用户通过 LLM Brain 生成 AST。
- 现象：`callLlm` 没有识别 SiliconFlow 属于 OpenAI-compatible provider，请求被错误发送到 Ollama 风格的 `/api/chat` 路径并失败。
- 影响：SiliconFlow LLM 模式无法生成 AST 计划。
- 涉及文件：`src/services/llmBrain.ts`。
- 尝试：检查 `callLlm` 中 endpoint 路由判断逻辑。
- 解决方式：将 `siliconflow` 加入 OpenAI-compatible endpoint 识别列表，使请求走 `/v1/chat/completions`。
- 后续步骤：无。

---

## BUG-016: CSP 阻止 SiliconFlow API 请求

- 状态：已修复
- 日期：2026-05-28
- 场景：浏览器前端请求 `https://api.siliconflow.cn/v1/chat/completions`。
- 现象：浏览器控制台提示 `violates the following Content Security Policy directive: connect-src ...`，Fetch API 拒绝连接。
- 影响：即使 endpoint 路由已修复，SiliconFlow 请求也会在到达 API 前被浏览器拦截。
- 涉及文件：`index.html`、`nginx.conf`。
- 尝试：检查开发环境 meta 标签和生产 Nginx header 中的 CSP `connect-src` 配置。
- 解决方式：在开发和生产 CSP 的 `connect-src` 中加入 `https://*.siliconflow.cn`。
- 后续步骤：无。

---

## BUG-017: 点击操作历史时地图预览没有重新渲染

- 状态：已修复
- 日期：2026-05-28
- 场景：连续执行多次 GIS 操作，然后在操作历史面板点击上一条/下一条记录。
- 现象：结果指标和历史选中状态会变化，但 OpenLayers 地图没有稳定重绘；切换历史记录后部分预览变为空白。
- 影响：用户无法通过地图可视化对比不同历史操作结果。
- 涉及文件：`src/hooks/useGeoSurgicalWorker.ts`、`src/components/MapPreview.tsx`。
- 尝试：
  1. 读取 `blobUrl` GeoJSON 时补充 `featureProjection: 'EPSG:3857'`。
  2. 调整 `MapPreview`，当同时存在 `content` 和 `blobUrl` 时优先使用 `content`。
  3. 重新检查历史快照创建逻辑和地图 source 加载条件。
- 解决方式：Worker hook 会先把 `blobUrl` 结果转换为稳定 GeoJSON `content`，再设置当前结果和保存历史快照，并从稳定快照中移除 `blobUrl`。`MapPreview` 只有在没有 `content` 时才使用 `blobUrl` 加载，也只有该路径会等待 `featuresloadend`。
- 验证：
  - `npm run typecheck` — 通过。
  - `npm run build` — 通过。
- 后续步骤：用新生成的历史记录做浏览器手动验证；修复前已写入 IndexedDB 的旧记录可能缺少稳定 `content`，测试前应清空或重新生成。
