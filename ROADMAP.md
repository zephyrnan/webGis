# GeoSurgical WebGIS 产品化路线图

## 背景

核心功能链路（上传 → 自然语言 → AST → WASM 执行 → 地图预览 → 导出）已全部打通，MVP + 阶段 A/B/C 均已完成。本文档规划从"MVP 完成"到"可交付产品"的路径。

当前状态：
- 15 个 AST 操作全部实现（TS + Rust + Zod + LLM prompt）
- AST Schema 单一来源已建立（`schemas/ast-schema.json`）
- 纯前端架构，无后端；远程 LLM API key 会暴露在浏览器 JS 中，生产建议使用本地 Ollama 或后端代理
- Docker 部署可用（Nginx 静态托管）
- 安全审计、类型检查、Lint、生产构建已通过
- 2026-05-28 已修复 SiliconFlow 接入、CSP connect-src 白名单、操作历史地图快照同步问题

---

## P0：发布前必须完成

### 0.1 手动浏览器验证 ✅
- [x] 上传 GeoJSON → metadata 正确显示
- [x] 上传 ZIP Shapefile → metadata + 编码检测（Lebanon ZIP 样例已进入 Real WASM metadata/图层流程）
- [x] Mock Brain 输入命令 → AST 生成（45 单元测试验证）
- [ ] LLM Brain（OpenAI-compatible endpoint / 本地 Ollama）→ AST 生成与执行完整流程（SiliconFlow 路由与 CSP 已修复，仍需浏览器端重新验证）
- [x] 结果导出下载（GeoJSON + CSV）
- [x] 6 语言切换正常
- **产出**：`ACCEPTANCE.md` 已更新

### 0.2 安全审计 ✅
- [x] 切换 npm registry 到官方源重跑 `npm audit`
- [x] 0 漏洞
- **产出**：`ACCEPTANCE.md` 已更新

### 0.3 Rust 编译警告清理 ✅
- [x] `cargo check` 零警告
- **产出**：已清理

### 0.4 Vite 构建产物体积优化 ✅
- [x] main chunk 398 kB（gzip 121 kB），无 chunk-size 警告
- [x] OpenLayers MapPreview 已动态导入（438 kB 独立 chunk）
- [x] WASM 已独立加载（1.2 MB）
- [x] Worker 已独立加载（16 kB）
- **产出**：`npm run build` 零警告，首屏 JS gzip 121 kB < 200 kB

---

## P1：质量与健壮性

### 1.1 真实取消任务 ✅
- **方案**：用户点击取消 → `worker.terminate()` → 清理状态 → 重建 Worker
- **涉及**：`src/hooks/useGeoSurgicalWorker.ts`、`src/workers/geosurgical.worker.ts`

### 1.2 LLM 自愈重试 ✅
- **方案**：校验失败后把错误信息 + 合法字段白名单 + 合法 action 列表发回 LLM，最多自动重试 1 次
- **涉及**：`src/services/llmBrain.ts`、`src/services/astValidation.ts`

### 1.3 fix_encoding 真实编码转换 ✅
- **方案**：引入 `encoding_rs`，读取 `.cpg` / DBF LDID，支持用户指定源编码
- **涉及**：`src-wasm/src/dispatcher.rs`、`src-wasm/Cargo.toml`

### 1.4 测试覆盖扩充 ✅
- **现状**：45 个单元测试（brain.test.ts、astValidation.test.ts、qualityReport.test.ts）
- **涉及**：`src/services/*.test.ts`

---

## P2：产品功能（阶段 D）

### 2.1 任务历史记录 ✅
- **功能**：保存每次上传 → 命令 → 结果的执行记录
- **存储**：IndexedDB（纯前端，无需后端）
- **UI**：左侧面板或顶部历史入口，可回看、重新执行
- **涉及**：新增 `src/services/history.ts`、`src/components/HistoryPanel.tsx`

### 2.2 AST 流水线模板 ✅
- **功能**：将常用 AST 操作链保存为模板，一键复用
- **存储**：IndexedDB + 导出/导入 JSON
- **UI**：Command Palette 中增加"保存为模板"/"加载模板"
- **涉及**：新增 `src/services/templates.ts`、扩展 `CommandPalette.tsx`

### 2.3 批处理 ✅
- **功能**：对多个文件执行同一 AST 流水线
- **方案**：多文件上传 → 共享 AST → 逐文件 Worker 执行 → 汇总结果
- **涉及**：扩展 `Dropzone.tsx`、新增 `useBatchProcessor.ts`、`BatchPanel.tsx`

### 2.4 多格式导出 ✅
- **现状**：支持 GeoJSON 和 CSV 导出
- **扩展**：
  - CSV（属性表导出，不含几何） ✅
  - **FlatGeobuf (.fgb)**（Rust 生态成熟，`flatgeobuf` crate 直接支持，生成速度极快，云原生格式）— 后续迭代
  - GeoParquet（列式存储，适合大规模属性分析场景）— 后续迭代
  - ~~Shapefile~~（写回需凑齐 .shp/.shx/.dbf，维护成本高，不推荐）
  - ~~MBTiles~~（需额外 Rust crate，优先级最低，暂不考虑）
- **涉及**：新增 `src/services/exportFormats.ts`、扩展 `src/components/ResultPanel.tsx`、`src/services/brain.ts`

### 2.5 数据质量报告 ✅
- **功能**：处理完成后生成摘要报告（要素数量变化、字段变化、CRS 变化、编码修复情况、几何合法性）
- **UI**：结果面板中增加"质量报告"折叠区域
- **涉及**：新增 `src/services/qualityReport.ts`、扩展 `src/components/ResultPanel.tsx`

---

## P3：架构改进

### 3.1 LLM Key 安全策略（生产本地/代理，开发支持 OpenAI-compatible） ✅
- **决策**：生产环境推荐本地 Ollama 或后端代理；开发环境可直连 OpenAI-compatible endpoint（OpenAI / DeepSeek / ModelScope / SiliconFlow 等），但不得把真实密钥用于公开生产前端构建。
- **方案**：README、`.env.example` 和部署文档明确说明 `VITE_*` 会注入浏览器 JS；CSP `connect-src` 维护允许的开发 endpoint 白名单。
- **近期同步**：2026-05-28 修复 SiliconFlow endpoint 识别和 CSP 白名单。
- **涉及**：`README.md`、`docker-compose.yml`、`.env.example`、`docs/deployment.md`、`index.html`、`nginx.conf`

### 3.2 私有化部署配置 ✅
- **功能**：提供完整的私有化部署文档和配置
- **内容**：
  - Docker Compose 包含 Ollama 服务 ✅
  - Nginx 反向代理配置（已有 nginx.conf）
  - 环境变量说明 ✅
  - 离线部署指南 ✅
- **涉及**：`docker-compose.yml`、`README.md`、`docs/deployment.md`

### 3.3 AST Schema 自动生成链 ✅
- **现状**：`schemas/ast-schema.json` 是唯一事实来源，TS/Zod/Rust/Prompt 全部自动生成
- **方案**：
  - **TS 端**：`json-schema-to-typescript` 从 schema 生成 TS 类型 ✅（`npm run generate:types`）
  - **Zod 端**：自动生成 discriminatedUnion 校验 ✅（`npm run generate:zod`）
  - **Rust 端**：自动生成 Operation enum + GeoSurgicalAst struct ✅（`npm run generate:rust`）
  - **LLM prompt**：自动生成 action 描述和参数列表 ✅（`npm run generate:prompt`）
- **涉及**：`scripts/generate-*.mjs`、`src/types/ast.generated.ts`、`src/services/astValidation.generated.ts`、`src-wasm/src/types.rs`、`src/services/llmPrompt.generated.ts`
- **命令**：`npm run generate:all` 一次性生成全部

---

## 执行顺序

```
P0.1 浏览器验证 ──→ P0.2 安全审计 ──→ P0.3 Rust 警告 ──→ P0.4 构建体积
                                                                          │
                                                                          v
P1.1 真实取消 ──→ P1.2 LLM 自愈 ──→ P1.3 fix_encoding ──→ P1.4 测试扩充
                                                                          │
                                                                          v
P2.1 任务历史 ──→ P2.2 AST 模板 ──→ P2.4 多格式导出 ──→ P2.5 质量报告 ──→ P2.3 批处理
                                                                          │
                                                                          v
P3.1 LLM 安全策略 ──→ P3.2 私有化部署 ──→ P3.3 Schema 自动生成
```
