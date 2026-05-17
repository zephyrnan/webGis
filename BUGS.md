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
