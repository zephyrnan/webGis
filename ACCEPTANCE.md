# 验收标准

## MVP 范围

- [x] 浏览器 SPA 可以接收 GIS 文件，并将重型解析放到 React 主线程之外。
- [x] Worker 可以持有上传文件 buffer，并请求 Rust WASM 或 Mock WASM 提取元数据。
- [x] 自然语言命令可以转换为经过校验的 GeoSurgical AST 操作。
- [x] Rust WASM dispatcher 可以执行核心 GeoJSON / ZIP Shapefile 操作，并返回可导出的结果。
- [x] OpenLayers 预览可以渲染生成的 GeoJSON 或大数据轻量预览。
- [x] 结果面板可以提供下载/复制操作；当存在 Blob URL 时避免对大型 WASM 输出重复序列化。

## Phase D 功能

- [x] 任务历史：基于 IndexedDB 持久化，支持恢复、删除、回放历史会话。
- [x] AST 流水线模板：支持保存、加载、导出、导入可复用操作链。
- [x] 批处理：对多个文件执行同一套 AST，并提供逐文件进度。
- [x] 多格式导出：支持 GeoJSON 和 CSV。
- [x] 数据质量报告：要素数量变化、编码修复、几何问题、警告。
- [x] AST Schema 类型生成：通过 `npm run generate:types` 从 `schemas/ast-schema.json` 生成。
- [x] 文本属性过滤：支持 `filter_attribute`，可按字段文本值 `==`、`!=`、`contains` 过滤要素。

## 2026-05-28 文本属性过滤升级

- [x] Schema 新增 `filter_attribute` 操作。
- [x] `npm run generate:all` 已更新 TypeScript、Zod、Rust 和 LLM Prompt 派生产物。
- [x] Rust WASM dispatcher 已实现 `Operation::FilterAttribute`。
- [x] LLM System Prompt 已补充文本属性过滤使用规则。
- [x] Mock Brain、自动补全、i18n 操作名和操作日志已同步。

## 2026-05-28 最近修复

- [x] SiliconFlow endpoint 会按 OpenAI-compatible `/v1/chat/completions` 请求处理。
- [x] 开发环境和 Nginx 的 CSP `connect-src` 均允许 `https://*.siliconflow.cn`。
- [x] 操作历史地图快照保存稳定 GeoJSON 内容，不再依赖可撤销 Blob URL。

## 2026-05-29 阶段 1：交付体验打磨

- [x] 上传、元数据提取、执行完成阶段有可见工作流状态提示。
- [x] Metadata 面板在上传/分诊期间显示 skeleton，不再只显示空态。
- [x] README 增加快速演示流程、示例命令、Mock Brain / LLM Brain 边界说明。
- [x] 生产安全边界继续明确：公开前端构建不得放入真实远程 LLM API key。

## 2026-05-29 阶段 2：可维护性治理

- [x] `src/i18n/locales.ts` 已拆为按语言维护的文件，并保留聚合导出兼容现有调用方。
- [x] `AppShell.tsx` 主要 UI 状态已迁移到 reducer，保留 worker 和 batch hook 职责边界。
- [x] `MapPreview.tsx` 统一 OpenLayers Map / Overlay / Select 生命周期，避免重复 Select interaction。
- [x] `src-wasm/src/dispatcher.rs` 已按职责机械拆分为 input、export、preview、util 和 ops 模块，`dispatcher::execute` 入口保持不变。

## 2026-05-29 Tauri 迁移方案 A：桌面增强层

- [x] 接入 Tauri v2 桌面壳，新增 `tauri`、`tauri:dev`、`tauri:build` 脚本。
- [x] Tauri Rust 后端实现 `invoke_llm`，读取 `TAURI_LLM_*` 并兼容 Ollama / OpenAI-compatible 路由。
- [x] Web 版 `llmBrain.ts` 保留原 fetch 逻辑；Tauri 环境通过 `invoke('invoke_llm')` 代理请求。
- [x] Dropzone 保留 Web 拖拽/文件 input；Tauri 环境额外显示原生“选择本地文件”按钮。
- [x] 原生文件选择只通过 dialog 获取路径，并由自定义 `read_local_file` command 读取受支持 GIS 文件字节。
- [x] `.env.example`、README、部署文档和产品文档已同步桌面端安全边界。

## 不在当前范围内

- 远程生产托管和自动化部署。
- 服务端存储或用户账号系统。
- 完整桌面 GIS 软件级能力。
- 保证支持所有 Shapefile 几何/编码边界场景。
- 保证真实 LLM 服务可用性；真实 LLM 取决于配置的本地或远程 endpoint。

## 验证项

- [x] 项目依赖已在本地安装。
- [x] 单元测试通过：3 个文件，共 47 个测试。
- [x] TypeScript 类型检查通过。
- [x] ESLint 通过。
- [x] Rust crate 检查通过，0 warning。
- [x] 生产构建通过，并已对 React / OpenLayers / Zod / Sentry 手动分包。
- [x] 核心可访问性通过：表单标签、切换、折叠、图标按钮、表格排序控件。
- [x] 已配置 ErrorBoundary、CSP headers、可选 Sentry 监控和 GitHub Actions CI。
- [x] `npm run generate:types` 通过。
- [x] 安全审计通过：官方 npm registry 下 0 vulnerabilities。
- [x] 已手动验证上传 → 元数据 → 命令 → 结果预览/下载核心流程。
- [x] 已验证 6 语言 UI 切换：zh、en、ja、ko、fr、es。

## 验收结果

- 状态：通过
- 已验证命令：
  - `npm run tauri:dev` — 通过，Tauri v2 首次编译完成并运行 `geosurgical-webgis-desktop.exe`（桌面增强层，2026-05-29）。
  - `cargo check --manifest-path src-tauri/Cargo.toml` — 通过（Tauri Rust LLM 代理与文件读取 command，2026-05-29）。
  - `npm run typecheck` — 通过（Tauri 前端适配，2026-05-29）。
  - `npm run lint` — 通过（Tauri 前端适配，2026-05-29）。
  - `npm test` — 通过，3 个文件 / 47 个测试（Tauri 前端适配，2026-05-29）。
  - `npm run build` — 通过（Tauri 前端适配，2026-05-29）。
  - `npm audit --registry https://registry.npmjs.org --audit-level=high` — 通过，0 vulnerabilities（Tauri 依赖接入，2026-05-29）。
  - `npm test` — 通过，3 个文件 / 47 个测试（阶段 1/2 改进，2026-05-29）。
  - `npm run typecheck` — 通过（阶段 1/2 改进，2026-05-29）。
  - `npm run lint` — 通过（阶段 1/2 改进，2026-05-29）。
  - `npm run build` — 通过（阶段 1/2 改进，2026-05-29）。
  - `cargo check --manifest-path src-wasm/Cargo.toml` — 通过，0 warning（dispatcher 拆分，2026-05-29）。
  - `cargo test --manifest-path src-wasm/Cargo.toml` — 通过，0 个 Rust 单元测试 / doctest（dispatcher 拆分，2026-05-29）。
  - `npm audit --registry https://registry.npmjs.org --audit-level=high` — 通过，0 vulnerabilities（阶段 1/2 改进，2026-05-29）。
  - `npm run typecheck` — 通过（点状小图层地图显示修复，2026-05-29）。
  - `npm run build` — 通过（点状小图层地图显示修复，2026-05-29）。
  - `npm test` — 通过，3 个文件 / 47 个测试（文本属性过滤升级，2026-05-28）。
  - `npm run generate:all` — 通过（文本属性过滤升级，2026-05-28）。
  - `npm run typecheck` — 通过（文本属性过滤升级，2026-05-28）。
  - `cargo check --manifest-path src-wasm/Cargo.toml` — 通过（文本属性过滤升级，2026-05-28）。
  - `npm run build` — 通过（文本属性过滤升级，2026-05-28）。
  - `npm test` — 通过，3 个文件 / 45 个测试。
  - `npm run typecheck` — 通过。
  - `npm run generate:types` — 通过。
  - `cargo check --manifest-path src-wasm/Cargo.toml` — 通过，0 warning。
  - `npm run build` — 通过，无 chunk-size warning。
  - `npm run typecheck` — 通过（重构后）。
  - `npm test` — 通过，45 个测试（重构后）。
  - `npm audit --registry https://registry.npmjs.org` — 通过，0 vulnerabilities。
  - `npm run typecheck` — 通过（生产可用性检查，2026-05-26）。
  - `npm test` — 通过，45 个测试（生产可用性检查，2026-05-26）。
  - `npm run lint` — 通过（生产可用性检查，2026-05-26）。
  - `npm run build` — 通过，使用手动分包（生产可用性检查，2026-05-26）。
  - `npm run typecheck` — 通过（SiliconFlow + 操作历史修复，2026-05-28）。
  - `npm run build` — 通过（SiliconFlow + 操作历史修复，2026-05-28）。
- 手动浏览器验证（2026-05-29，阶段 1/2 改进）：
  - [x] 页面可以正常加载，并显示 Real WASM 指示。
  - [x] 上传 `test-data/sample.geojson` 后 Metadata Dry Run 正常显示。
  - [x] 命令“删除 name 为空的要素，然后导出 GeoJSON”可以生成 AST。
  - [x] 点击确认执行后生成结果摘要和“下载 GeoJSON”入口。
  - [x] 当前页面控制台无错误；热更新期间出现的临时 i18n 语法错误已修复并刷新验证。
- 手动浏览器验证（2026-05-25）：
  - [x] 页面可以正常加载，并显示 Real WASM 指示。
  - [x] 6 语言切换正常：zh、en、ja、ko、fr、es。
  - [x] GeoJSON 上传 → 元数据提取（要素、CRS、编码、bbox、字段）。
  - [x] 可以根据元数据生成快捷标签。
  - [x] 进度时间线显示 metadata 事件。
  - [x] Mock Brain 命令解析已通过 47 个单元测试验证。
  - [x] 错误提示可以显示 LLM 错误和恢复建议。
  - [x] 三栏仪表盘布局（12 栏 grid）无全局滚动条。
  - [x] 已应用克制明亮的工具型界面风格。
  - [x] 图层树支持可见性切换和字段结构展开。
- 已知问题：
  - LLM Brain 依赖外部 API 可用性（额度、网络、模型行为）。需要稳定运行时，使用 Mock Brain 或本地 Ollama。
  - 操作历史地图预览修复已在 2026-05-28 通过 typecheck / build 验证；手动浏览器验证请使用新生成的历史记录，因为旧 IndexedDB 快照可能缺少稳定 GeoJSON 内容。
- 备注：
  - P0 和 P1 ROADMAP 项已完成。
  - P2 ROADMAP 项已完成：历史、模板、批处理、导出、质量报告。
  - P3.1（LLM 安全策略）、P3.2（部署）、P3.3 部分（TS 类型生成）已完成。
  - 生产可用性检查已添加 ErrorBoundary、CSP、依赖固定、GitHub Actions CI、可选 Sentry、可访问性属性和 Vite 手动分包。
  - 2026-05-28 文档同步已更新 README、`.env.example`、ROADMAP、ACCEPTANCE、BUGS，覆盖 SiliconFlow、CSP、操作历史地图快照修复。
