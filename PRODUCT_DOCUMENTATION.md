# GeoSurgical WebGIS 产品架构与路线图文档

## 1. 产品核心定位与理念

GeoSurgical WebGIS 的核心定位不是传统 GIS 控制台，而是一个面向空间数据的**“语言驱动手术台”**：用户上传数据后，用自然语言描述清洗、筛选、坐标转换、字段处理等需求，系统将意图翻译成可执行的标准指令，再由本地高性能引擎完成处理。

### 核心工程约束与原则

*   **前端不做复杂表单堆叠**：避免把用户拖进坐标系选择、字段映射、重命名规则等配置面板。
*   **主线程不拆包**：任何 zip 解压、DBF 解析、Shapefile header 读取都不能放在 React 主线程。JavaScript 不碰重度二进制解析。
*   **Buffer 所有权单行道**：`ArrayBuffer` transfer 给 Worker 后，主线程不能再读写它。
*   **Worker 持有任务上下文**：同一个任务的 Dry Run 和正式执行必须复用 Worker 内的 buffer，而不是主线程反复传递。
*   **LLM 只看摘要，不看坐标**：大模型（The Brain）只能接收 Metadata（字段描述、预估数量等摘要）、用户指令和 AST schema，绝不读取完整几何坐标。
*   **Metadata 必须控量**：字段过多时必须截断，字段 sample 必须限制数量、长度和总 token 预算，避免撑爆 LLM 上下文。
*   **Rust WASM 不绑定固定按钮**：Rust 核心只暴露稳定入口，接收 JSON 指令集（AST），并按指令动态分发和执行空间处理任务。
*   **重计算全部本地化**：真实文件解析、几何计算、坐标转换、导出都在浏览器本地 Worker 线程完成。
*   **撤销能力分级**：小文件允许保留快照，大文件默认只保留操作日志和重新执行能力（replay），避免内存被撑爆。
*   **进度必须有心跳**：Rust Dispatcher 处理长任务时必须定期发 progress event，避免界面看起来像卡死。
*   **错误必须结构化**：Rust 和 Worker 返回的错误要包含 `code`、`message`、`recoverable` 和可选 `suggestedUserInput`。

---

## 2. 整体架构概览

系统由四层架构组成：React 主线程（UI与调度）、大模型中枢（语义理解）、Web Worker & Rust WASM（二进制处理与计算），以及可选的 Tauri 桌面增强层。

```text
React UI 主线程
  左侧：Dropzone文件上传 / Metadata摘要 / 图层树 / 批处理面板
  中间：OpenLayers 地图预览 (WebGL/Canvas)
  右侧：CommandPalette (自然语言输入) / AST 预览 / History / Result导出
        |
        | 1. Transferable ArrayBuffer (仅上传时一次)
        | 2. GeoSurgical AST JSON 指令
        v
Web Worker 隔离层
  任务上下文持有上传文件 buffer
        |
        v
Rust WASM 引擎 (真正的"手术刀")
  1. extract_metadata() -> 仅扫描头部，返回轻量 JSON Metadata
  2. execute_surgery()  -> 解析 AST，Dispatcher 路由到底层几何/属性操作，返回 Envelope + GeoJSON Payload

可选 Tauri 桌面增强层
  1. 提供桌面窗口容器，不改写 Web Worker + Rust WASM GIS 链路
  2. Rust 后端代理 LLM 请求，读取 TAURI_LLM_*，避免 API key 注入前端 JS
  3. 使用原生文件对话框选择本地 GIS 文件，再复用现有 Worker 上传流程
```

### 推荐执行链路

1.  用户拖拽上传 GIS 文件（GeoJSON / ZIP Shapefile）。
2.  主线程获取 `ArrayBuffer`，**不做任何解析**。
3.  主线程通过 Transferable Objects 将 `ArrayBuffer` 盲传给 Worker。
4.  Worker 持有原始 buffer，并调用 Rust `extract_metadata` 做 Dry Run。
5.  Rust 只扫描必要二进制头部和目录结构，回传 Metadata JSON（包含截断与采样的字段摘要）。
6.  主线程展示 Metadata 摘要、warning 和**动态快捷指令 Tag**（避免用户面对空白输入框无从下手）。
7.  用户点击快捷 Tag 或在 Command Palette 中输入自然语言需求。
8.  The Brain 将“自然语言 + Metadata”转换为 GeoSurgical AST。
    *   *如字段缺失，主线程向 Worker 发起轻量字段检索，再让 The Brain 补全 AST。*
9.  前端基于 Schema/Zod 安全校验 AST，并展示执行计划。
10. 用户确认后，主线程只把 AST 发给 Worker。
11. Worker 复用已持有的 buffer，调用 Rust WASM 的 `execute_surgery`。
12. Rust Dispatcher 按 AST 动态执行空间处理流水线，并**定期上报进度心跳**。
13. Worker 返回处理结果（二进制）、日志、质量摘要和撤销能力标记。
14. OpenLayers 渲染结果（大数据量走 WebGL，轻量预览走凸包），用户审阅后触发原生下载。

---

## 3. 技术基座与 Schema-Driven 设计

项目采用纯 SPA 架构（不依赖服务端渲染），通过高度的自动化生成链保证全栈类型安全。

*   **技术栈**: Vite, React 19, TypeScript, Tailwind CSS, OpenLayers, Zod.
*   **计算层**: Rust, wasm-bindgen, Web Worker.
*   **依赖生态**: Rust 端使用了 `geo`, `geojson`, `shapefile`, `zip`, `encoding_rs` 等库。

### Schema-Driven 自动生成管线

项目的核心约束来源是 `schemas/ast-schema.json`。通过 `scripts/generate-*.mjs` 脚本，可以实现一套定义，四处生效：

1.  **TypeScript 类型** (`ast.generated.ts`)
2.  **Zod 校验器** (`astValidation.generated.ts`)
3.  **Rust Serde 结构体** (`src-wasm/src/types.rs`)
4.  **LLM Prompt 指令** (`llmPrompt.generated.ts`)

---

## 4. 产品进化里程碑

项目从零到一经历了以下关键阶段：

1.  **数据大动脉建设**：打通主线程到 Worker 的 ArrayBuffer 盲传与所有权转移。
2.  **机械肌肉 (Rust) 构造**：实现 Rust WASM 解析二进制 header 并输出 Metadata（Dry Run）。
3.  **大模型中枢 (Brain) 对接**：实现 Prompt 拦截，将自然语言基于 Metadata 翻译为合法的 AST 指令集。
4.  **真实算力注入 (Dispatcher)**：在 Rust 端实现 Dispatcher 模式，对接 `georust` 生态执行投影转换、面积过滤、抽稀等，并实现进度心跳。
5.  **WebGL 可视化与生命周期闭环**：OpenLayers 对接处理后的二进制流渲染（Blob URL），实现真导出和严格的内存释放。

---

## 5. 项目路线图与 Checklist (ROADMAP)

以下记录了从 MVP 完成后，项目走向生产就绪级别所完成的历史 Checklist 状态。

### P0：发布前必须完成
*   [x] **手动浏览器验证**
    *   上传 GeoJSON → metadata 正确显示
    *   上传 ZIP Shapefile → metadata + 编码检测
    *   Mock Brain 输入命令 → AST 生成
    *   结果导出下载（GeoJSON + CSV）
    *   6 语言切换正常
*   [x] **安全审计**：官方源 npm audit 0 漏洞。
*   [x] **Rust 编译警告清理**：cargo check 零警告。
*   [x] **Vite 构建产物体积优化**：WASM 与 Worker 独立加载，首屏 JS 优化。

### P1：质量与健壮性
*   [x] **真实取消任务**：用户点击取消 → worker.terminate() → 清理状态 → 重建 Worker。
*   [x] **LLM 自愈重试**：校验失败后把错误信息 + 合法字段白名单发回 LLM，自动重试 1 次。
*   [x] **fix_encoding 真实编码转换**：引入 `encoding_rs`，支持源编码修正。
*   [x] **测试覆盖扩充**：包含 brain, astValidation, qualityReport 等 47 个单元测试。

### P2：产品功能
*   [x] **任务历史记录**：基于 IndexedDB 的上传 → 命令 → 结果历史保存与回看。
*   [x] **AST 流水线模板**：保存 AST 操作链为模板，支持导入导出。
*   [x] **批处理**：多文件上传，共享一套 AST，逐文件 Worker 处理并追踪进度。
*   [x] **多格式导出**：支持 GeoJSON 和 CSV 导出。*(未来扩展考量: FlatGeobuf)*
*   [x] **数据质量报告**：生成要素数量、CRS、编码修复和几何合法性变化的对比摘要。

### P3：架构改进
*   [x] **LLM Key 安全策略**：生产环境推荐本地 Ollama，开发环境通过 CSP 白名单支持 OpenAI-compatible endpoint (如 SiliconFlow)。前端不暴露真实 Key。
*   [x] **私有化部署配置**：提供完整的 docker-compose 方案，含 Nginx 反代与 Ollama 服务。
*   [x] **AST Schema 自动生成链**：建立 `npm run generate:all` 管线，统一 TS/Zod/Rust/Prompt。
*   [x] **UI 状态管理升级**：(2026-05) `AppShell` 迁移至 `useReducer` 提升复杂状态可维护性。
*   [x] **Rust 代码模块化**：(2026-05) 拆分 100KB+ 单文件 dispatcher，实现模块化治理。
*   [x] **Tauri 桌面增强层**：(2026-05) 接入 Tauri v2，增加桌面窗口、Rust LLM 代理和原生文件选择，同时保持 Web 版兼容。
