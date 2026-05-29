# GeoSurgical WebGIS

GeoSurgical WebGIS 是一个由自然语言驱动的空间数据处理工作台。用户可以上传 GIS 文件，在浏览器本地查看元数据，用自然语言描述清洗、转换或导出需求，审查生成的 GeoSurgical AST，通过 Web Worker 中的 Rust WASM 引擎执行操作，在地图上预览结果并导出文件。

## 功能概览

- 支持上传 `.geojson`、`.json` 和 `.zip` Shapefile 文件。
- 上传文件的 `ArrayBuffer` 会转交给 Web Worker，避免重型解析阻塞 React 主线程。
- 通过 Rust WASM 提取元数据，并提供 TypeScript Mock WASM 回退。
- 根据元数据、CRS、字段、图层和警告生成快捷命令标签。
- 支持 Mock Brain 或可配置 LLM Brain，将自然语言命令转换为 GeoSurgical AST。
- 使用 TypeScript / Zod 白名单校验 AST，再交给 Worker 执行。
- Rust WASM 支持过滤、字段清理、CRS 转换、编码修复、简化、字段计算、几何校验、缓冲区、裁剪、相交、融合和导出。
- 使用 OpenLayers 预览 GeoJSON 输出，支持 WebGL / Canvas 切换、要素弹窗和属性表。
- 大数据结果可使用轻量凸包预览，避免一次性渲染过多要素。
- 使用 Blob URL 下载结果，减少大型 JSON 重序列化。
- 支持 GeoJSON 和 CSV 多格式导出。
- 支持基于 IndexedDB 的任务历史，可恢复、删除和回放历史会话。
- 支持 AST 流水线模板的保存、加载、导出和导入。
- 支持批处理：对多个文件执行同一套 AST 流水线，并显示逐文件进度。
- 提供数据质量报告：要素数量变化、编码修复、几何问题和警告。
- 支持 6 种界面语言：中文、英文、日文、韩文、法文、西班牙文。
- 使用 React ErrorBoundary 保护应用级和地图渲染错误。
- 核心控件覆盖基础可访问性：表单标签、切换状态、折叠状态、键盘可操作表格排序等。
- 生产硬化：CSP 配置、可选 Sentry 监控、GitHub Actions CI，以及 React / OpenLayers / Zod / Sentry 手动分包。

## 技术栈

- Vite + React + TypeScript
- Tailwind CSS
- OpenLayers
- Web Worker API + Transferable Objects
- Rust + wasm-bindgen + `geo` / `geojson` / `shapefile` / `zip` / `encoding_rs`
- Zod
- Sentry React SDK（可选，通过 DSN 控制）
- Vitest、Playwright 脚本、GitHub Actions CI

## 架构概览

```text
React UI 主线程
  h-screen 三栏工作台（grid-cols-12）
  左侧 3 栏：文件上传 / 图层树 / 批处理
  中间 5 栏：OpenLayers 地图画布
  右侧 4 栏：命令面板 / AST 预览 / 历史 / 结果
        |
        | Transferable ArrayBuffer + AST 消息
        v
Web Worker
  任务上下文持有上传文件 buffer
        |
        v
Rust WASM 引擎
  提取元数据 -> 执行 GeoSurgical AST -> 返回 envelope + payload
```

核心约束：

- React 主线程不能解压或解析大型 GIS 二进制文件。
- 上传文件转交后由 Worker 持有文件 buffer。
- LLM Brain 只接收元数据摘要和用户命令，不接收完整几何数据。
- 所有操作必须先表现为可审计的 JSON AST，再执行。
- `schemas/ast-schema.json` 是 AST 类型的唯一事实来源。修改后运行 `npm run generate:types` 重新生成 TypeScript 类型。

## 本地启动

### 前置要求

- Node.js 与 npm
- Rust 工具链与 Cargo
- 可选：重建 `src-wasm/pkg` 时需要 `wasm-pack`
- 可选：本地 Ollama 或 OpenAI-compatible endpoint，用于真实 LLM Brain 模式

### 安装依赖

```bash
npm install
```

### 环境变量

如果要配置 LLM 模式，将 `.env.example` 复制为 `.env`。`.env` 和 `.env.*` 已被 Git 忽略，只有 `.env.example` 会保留在仓库中。

**安全提示**：这是纯前端应用，所有 `VITE_*` 变量都会在构建时注入浏览器 JavaScript。生产环境不要直接使用远程 API key。生产推荐使用本地 Ollama，或用后端代理把 API key 留在服务端。

| 变量名 | 是否必填 | 说明 |
| --- | --- | --- |
| `VITE_BRAIN_MODE` | 否 | `mock` 或 `llm`；控制 Mock Brain 与配置的 LLM Brain。 |
| `VITE_LLM_ENDPOINT` | 否 | LLM 端点，例如本地 Ollama `http://localhost:11434`，或开发时使用 OpenAI / DeepSeek / ModelScope / SiliconFlow 等 OpenAI-compatible endpoint。 |
| `VITE_LLM_API_KEY` | 否 | OpenAI-compatible provider 的 API key；本地 Ollama 不需要。生产前端构建中不要使用真实远程 API key。 |
| `VITE_LLM_MODEL` | 否 | LLM Brain 使用的模型名。 |
| `VITE_SENTRY_DSN` | 否 | 提供后启用 Sentry 前端错误监控。 |

#### 开发环境使用远程 OpenAI-compatible LLM

本地开发时如果要使用 SiliconFlow 等远程兼容服务，可以这样修改 `.env`：

```env
VITE_BRAIN_MODE=llm
VITE_LLM_ENDPOINT=https://api.siliconflow.cn
VITE_LLM_API_KEY=your-api-key-here
VITE_LLM_MODEL=deepseek-ai/DeepSeek-V4-Flash
```

修改 `.env` 后必须重启 Vite dev server，因为 Vite 会在启动时读取 `VITE_*` 变量：

```bash
npm run dev
```

当前 OpenAI-compatible endpoint 自动识别包含：OpenAI、DeepSeek、ModelScope、SiliconFlow，以及显式包含 `/v1/chat/completions` 的 endpoint。如果新增远程 provider，需要同步检查 `index.html` 和 `nginx.conf` 中 CSP `connect-src` 白名单。

不要把真实远程 API key 放入公开生产前端构建。生产请使用后端代理或本地 Ollama。

### 运行开发服务器

```bash
npm run dev
```

### 构建

```bash
npm run build
```

### 使用 Docker Desktop 运行

确保 Docker Desktop 已启动，然后构建并启动容器：

```powershell
docker compose up --build
```

打开 `http://localhost:8080` 查看应用。

常用 Docker 命令：

```powershell
# 只构建生产镜像
docker compose build

# 后台启动
docker compose up -d

# 查看日志
docker compose logs -f webgis

# 停止并删除容器
docker compose down
```

默认 Docker 构建使用 Mock Brain，容器不依赖 LLM 服务。如果要用 LLM 模式，可在 Compose 前设置构建变量：

```powershell
$env:VITE_BRAIN_MODE="llm"
$env:VITE_LLM_ENDPOINT="http://localhost:11434"
$env:VITE_LLM_MODEL="qwen2.5:7b"
docker compose up --build
```

Vite 的 `VITE_*` 环境变量是在构建时注入的。如果修改 `.env` 或 shell 环境变量，需要重新执行 `docker compose up --build`。

不要在生产构建的前端 `VITE_*` 变量中放私有 API key。

### 重建 Rust WASM

```bash
cd src-wasm
wasm-pack build --target web --release
```

## 常用脚本

| 命令 | 说明 |
| --- | --- |
| `npm run dev` | 启动 Vite 开发服务器。 |
| `npm run build` | 执行 TypeScript 项目构建和 Vite 生产构建。 |
| `npm run preview` | 预览生产构建产物。 |
| `npm test` | 运行 Vitest 单元测试。 |
| `npm run test:watch` | 以 watch 模式运行 Vitest。 |
| `npm run test:e2e` | 运行 Playwright 端到端测试。 |
| `npm run typecheck` | 运行 TypeScript 项目检查。 |
| `npm run lint` | 运行 ESLint。 |
| `npm run generate:types` | 根据 `schemas/ast-schema.json` 生成 TypeScript 类型。 |
| `cargo check --manifest-path src-wasm/Cargo.toml` | 检查 Rust WASM crate。 |
| `docker compose up --build` | 构建并在 8080 端口运行生产静态应用。 |
| `docker compose down` | 停止并删除本地 Docker 容器。 |

## 支持的 AST 操作

| Action | 用途 |
| --- | --- |
| `filter_area` | 按数值字段、操作符和值过滤要素。 |
| `filter_attribute` | 按文本属性字段过滤或保留要素，支持 `==`、`!=`、`contains`。 |
| `drop_empty` | 删除指定字段为空的要素。 |
| `rename_field` | 重命名属性字段。 |
| `transform_crs` | 转换支持的 CRS，例如 WGS84 / GCJ-02 / Web Mercator。 |
| `fix_encoding` | 使用指定源编码重新解码 DBF 文本。 |
| `simplify` | 按容差简化支持的几何。 |
| `field_calculate` | 根据数值操作数计算目标字段。 |
| `validate_geometry` | 检查或修复简单的无效几何。 |
| `buffer` | 创建近似缓冲区几何。 |
| `clip` | 保留与 bbox 相交的要素。 |
| `intersect` | 保留与 bbox 相交的要素。 |
| `dissolve` | 按字段值融合多边形要素。 |
| `export` | 导出结果。 |
| `noop` / `need_clarification` | 表示不支持或含糊的规划输出。 |

## 验证状态

最新验收状态记录在 `ACCEPTANCE.md`。

2026-05-28 已验证：

- `npm run generate:all` — 通过，已从 Schema 生成 TypeScript、Zod、Rust 和 LLM Prompt 派生产物。
- `npm test` — 通过，3 个文件 / 47 个测试，覆盖 `filter_attribute` AST 校验和 Mock Brain 文本属性过滤识别。
- `npm run typecheck` — 通过，覆盖 `filter_attribute` 全链路类型更新。
- `cargo check --manifest-path src-wasm/Cargo.toml` — 通过，Rust WASM dispatcher 文本属性过滤分支编译通过。
- `npm run build` — 通过，生产构建可用。
- `npm run typecheck` — 通过，覆盖 SiliconFlow endpoint / CSP / 操作历史地图同步修复。
- `npm run build` — 通过，覆盖 SiliconFlow endpoint / CSP / 操作历史地图同步修复。
- CSP 已在 `index.html` 和 `nginx.conf` 中允许 SiliconFlow 开发请求。
- 操作历史快照已改为保存稳定 GeoJSON 内容，不再依赖可撤销 Blob URL。

2026-05-26 已验证：

- `npm run typecheck` — 通过。
- `npm test` — 通过，45 个测试。
- `npm run lint` — 通过。
- `npm run build` — 通过，并拆分 React / OpenLayers / Zod / Sentry chunk。
- 核心可访问性检查已完成：标签控件、toggle / disclosure 状态、历史按钮、地图弹窗关闭、属性表排序。

生产使用前仍建议用代表性的 GeoJSON 和 ZIP Shapefile 样例做手动浏览器验证。

## 项目文档

- `产品蓝图.md` — 架构与产品蓝图。
- `DESIGN.md` — UI 方向与组件规则。
- `ACCEPTANCE.md` — MVP 范围和验收状态。
- `BUGS.md` — 问题历史、验证发现和解决记录。
- `ROADMAP.md` — 产品路线图和完成状态。
- `docs/deployment.md` — Docker Compose 与 Ollama 私有化部署指南。

## 部署说明

当前仓库未配置远程生产部署目标。可以运行 `npm run build`，然后将生成的 `dist` 目录部署到支持 Worker modules 和 WASM 资源的静态托管服务。

如需本地容器化预览，可使用仓库内的 `Dockerfile`、`nginx.conf` 和 `docker-compose.yml`，由 Docker Desktop 构建 Vite 应用并用 Nginx 托管 `dist`。

## 已知限制

- 大型 ZIP Shapefile 工作流在生产使用前应使用代表性文件验证。
- 真实 LLM 模式依赖 endpoint 可达性和模型行为；远程 OpenAI-compatible provider 支持开发调试，但生产应使用本地 Ollama 或后端代理，避免 API key 暴露在浏览器 JavaScript 中。
- 2026-05-28 Blob URL 快照修复前创建的操作历史可能不包含稳定 GeoJSON 内容；重新测试地图同步前建议清空或重新生成旧 IndexedDB 历史。
- 真正的多边形裁剪/相交能力仍弱于完整桌面 GIS 引擎。

详细问题历史和当前验证备注见 `BUGS.md`。
