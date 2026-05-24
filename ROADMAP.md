# GeoSurgical WebGIS 产品化路线图

## Context

核心功能链路（上传 → 自然语言 → AST → WASM 执行 → 地图预览 → 导出）已全部打通，MVP + 阶段 A/B/C 均已完成。本文档规划从"MVP 完成"到"可交付产品"的路径。

当前状态：
- 15 个 AST 操作全部实现（TS + Rust + Zod + LLM prompt）
- AST Schema 单一来源已建立（`schemas/ast-schema.json`）
- 纯前端架构，无后端，LLM key 暴露在浏览器 JS 中
- Docker 部署可用（Nginx 静态托管）
- 手动浏览器验证未完成，安全审计未通过

---

## P0：发布前必须完成

### 0.1 手动浏览器验证
- [ ] 上传 GeoJSON → metadata 正确显示
- [ ] 上传 ZIP Shapefile → metadata + 编码检测
- [ ] Mock Brain 输入命令 → AST 生成 → 执行 → 地图渲染
- [ ] LLM Brain（本地 Ollama）→ 同上完整流程
- [ ] 结果导出下载
- [ ] 6 语言切换正常
- **产出**：更新 `ACCEPTANCE.md` 验证状态

### 0.2 安全审计
- [ ] 切换 npm registry 到官方源重跑 `npm audit`
- [ ] 修复高危漏洞（如有）
- **产出**：更新 `ACCEPTANCE.md` + `BUGS.md`

### 0.3 Rust 编译警告清理
- [ ] `dispatcher.rs` unused mutability / dead field 警告
- [ ] `metadata.rs` 同类警告
- **产出**：`cargo check` 零警告

### 0.4 Vite 构建产物体积优化
- [ ] 当前 main chunk 超过 500kB 触发警告
- [ ] 元凶：OpenLayers + WASM 胶水代码占大头，tree-shaking 收效有限
- [ ] 方案：对 OpenLayers 组件（`MapPreview.tsx`）和 WASM 模块使用 **动态导入**（`import()`）
- [ ] 首屏只加载极简 UI 壳子，用户拖入文件时再异步拉取地图渲染引擎和算力模块
- [ ] 涉及：`src/components/MapPreview.tsx`、`src/wasm/geosurgicalRealWasm.ts`、`src/workers/geosurgical.worker.ts`
- **产出**：`npm run build` 零警告，首屏 JS < 200kB

---

## P1：质量与健壮性

### 1.1 真实取消任务
- **现状**：取消只在 JS 调度阶段有效，Rust/WASM 执行中无法中断
- **方案**：用户点击取消 → `worker.terminate()` → 清理状态 → 重建 Worker
- **涉及**：`src/hooks/useGeoSurgicalWorker.ts`、`src/workers/geosurgical.worker.ts`
- **验收**：大文件处理中点击取消，UI 立即恢复可交互状态

### 1.2 LLM 自愈重试
- **现状**：AST 校验失败直接报错给用户
- **方案**：校验失败后把错误信息 + 合法字段白名单 + 合法 action 列表发回 LLM，最多自动重试 1 次
- **涉及**：`src/services/llmBrain.ts`、`src/services/astValidation.ts`
- **验收**：故意输入模糊命令，系统自动修正一次后成功

### 1.3 fix_encoding 真实编码转换
- **现状**：Rust 侧 `FixEncoding` 是 pass-through 占位
- **方案**：引入 `encoding_rs`，读取 `.cpg` / DBF LDID，支持用户指定源编码（GBK/windows-1256/shift_jis 等）
- **涉及**：`src-wasm/src/dispatcher.rs`、`src-wasm/Cargo.toml`
- **验收**：上传含 GBK 编码的 Shapefile，执行 fix_encoding 后属性乱码修复

### 1.4 测试覆盖扩充
- **现状**：7 个单元测试 + 6 个 E2E 测试
- **目标**：
  - 每个 AST 操作至少 1 个单元测试（schema 合法 + 非法）
  - Brain 关键词匹配覆盖所有操作
  - E2E 覆盖主要路径（上传 → 命令 → 执行 → 下载）
- **涉及**：`src/services/*.test.ts`、`e2e/*.spec.ts`

---

## P2：产品功能（阶段 D）

### 2.1 任务历史记录
- **功能**：保存每次上传 → 命令 → 结果的执行记录
- **存储**：IndexedDB（纯前端，无需后端）
- **UI**：左侧面板或顶部历史入口，可回看、重新执行
- **涉及**：新增 `src/services/history.ts`、`src/components/HistoryPanel.tsx`

### 2.2 AST 流水线模板
- **功能**：将常用 AST 操作链保存为模板，一键复用
- **存储**：IndexedDB + 导出/导入 JSON
- **UI**：Command Palette 中增加"保存为模板"/"加载模板"
- **涉及**：新增 `src/services/templates.ts`、扩展 `CommandPalette.tsx`

### 2.3 批处理
- **功能**：对多个文件执行同一 AST 流水线
- **方案**：多文件上传 → 共享 AST → 逐文件 Worker 执行 → 汇总结果
- **涉及**：扩展 `Dropzone.tsx`、`useGeoSurgicalWorker.ts`

### 2.4 多格式导出
- **现状**：仅支持 GeoJSON 导出
- **扩展**：
  - CSV（属性表导出，不含几何）
  - **FlatGeobuf (.fgb)**（Rust 生态成熟，`flatgeobuf` crate 直接支持，生成速度极快，云原生格式）
  - GeoParquet（列式存储，适合大规模属性分析场景）
  - ~~Shapefile~~（写回需凑齐 .shp/.shx/.dbf，维护成本高，不推荐）
  - ~~MBTiles~~（需额外 Rust crate，优先级最低，暂不考虑）
- **涉及**：`src-wasm/src/dispatcher.rs`、`src-wasm/Cargo.toml`（新增 `flatgeobuf` crate）、`src/components/ResultPanel.tsx`

### 2.5 数据质量报告
- **功能**：处理完成后生成摘要报告（要素数量变化、字段变化、CRS 变化、编码修复情况、几何合法性）
- **UI**：结果面板中增加"质量报告"标签页
- **涉及**：`src/components/ResultPanel.tsx`、Rust 返回统计信息

---

## P3：架构改进

### 3.1 LLM Key 安全策略（已决定：仅支持本地 Ollama）
- **决策**：生产环境仅支持本地 Ollama，不暴露远程 API key
- **方案**：README 和部署文档明确说明；移除 `VITE_LLM_API_KEY` 的使用场景说明；Docker Compose 可选集成 Ollama 服务
- **涉及**：`README.md`、`docker-compose.yml`、`.env.example`

### 3.2 私有化部署配置
- **功能**：提供完整的私有化部署文档和配置
- **内容**：
  - Docker Compose 包含 Ollama 服务
  - Nginx 反向代理配置
  - 环境变量说明
  - 离线 WASM 模块打包
- **涉及**：`docker-compose.yml`、`README.md`、新增 `docs/deployment.md`

### 3.3 AST Schema 自动生成链
- **现状**：`schemas/ast-schema.json` 是手动维护的，与 TS/Rust/Zod 之间靠文档约束同步
- **长期目标**：从 schema 自动生成 TS 类型、Zod 校验、Rust enum、LLM prompt 摘要
- **方案**：
  - **Rust 端**：`build.rs` 中使用 `typify` 或 `schemars` crate，编译期读取 `ast-schema.json` 动态生成 Rust 类型代码，彻底消除手动同步 `types.rs`
  - **TS 端**：`json-schema-to-typescript` 从 schema 生成 TS 类型
  - **Zod 端**：从 schema 生成或手写 Zod 校验（与 TS 类型同源）
  - **LLM prompt**：从 schema 自动生成 action 摘要嵌入 prompt
- **涉及**：`src-wasm/build.rs`、`src-wasm/Cargo.toml`（新增 `typify`/`schemars`）、构建工具链配置

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
