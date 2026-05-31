# GeoSurgical WebGIS

自然语言驱动的空间数据处理工作台。上传 GIS 文件，用自然语言描述清洗/转换/导出需求，系统编译为可审计 AST，通过 Rust WASM 引擎在浏览器本地执行。

## 功能特性

**核心能力**
- 支持 `.geojson`、`.json`、ZIP Shapefile 上传，`ArrayBuffer` 转交 Web Worker 处理
- Rust WASM 引擎提取元数据 + 执行 17 种 AST 操作
- 17 种操作：过滤、重命名、CRS 转换、通用重投影、编码修复、简化、字段计算、几何校验、缓冲区、精确裁剪、边界框筛选、融合、导出等
- Mock Brain 或可配置 LLM Brain（Ollama / OpenAI-compatible / SiliconFlow）
- UI 中可切换 LLM Provider、Endpoint、Model、API Key（保存到 localStorage）

**数据管理**
- IndexedDB 任务历史：恢复、删除、回放
- AST 模板：保存、加载、导出、导入
- 批处理：Worker Pool 并发执行多文件，逐文件进度条
- 多格式导出：GeoJSON / CSV / Shapefile ZIP

**界面**
- OpenLayers 地图：WebGL/Canvas 切换、要素弹窗、属性表、透明度滑块
- 大数据凸包预览，避免一次性渲染过多要素
- 6 种语言：中文 / English / 日本語 / 한국어 / Français / Español
- 三栏工作台布局（上传/图层 · 地图 · 命令/AST/历史）

**工程**
- Schema 驱动四端自动生成（JSON Schema → TS/Zod/Rust/Prompt）
- LLM 解析容错：处理 markdown 代码块、trailing comma、注释、单引号等
- React ErrorBoundary + CSP + 可选 Sentry + GitHub Actions CI（4 job）
- Docker + Nginx 容器化部署
- Tauri v2 桌面端（原生文件对话框 + Rust LLM 代理）

## 技术栈

| 层 | 技术 |
|---|---|
| 前端 | Vite 8 + React 19 + TypeScript + Tailwind CSS 4 |
| 地图 | OpenLayers 10 |
| 校验 | Zod 4 + JSON Schema |
| 计算引擎 | Rust WASM (geo 0.28 + proj4rs + shapefile + encoding_rs) |
| 桌面 | Tauri v2 |
| 测试 | Vitest + Playwright + cargo test |
| 部署 | Docker + Nginx + GitHub Actions CI |

## 架构

```text
React UI (三栏工作台)
  │
  │ Transferable ArrayBuffer + AST 消息
  ▼
Web Worker Pool (并发度 = min(4, cores-1))
  │
  ▼
Rust WASM 引擎
  元数据提取 → AST 执行 → envelope + payload
```

核心约束：
- React 主线程不解压/解析 GIS 二进制
- LLM Brain 只接收元数据摘要，不接收几何数据
- 所有操作先编译为 JSON AST，校验后执行
- `schemas/ast-schema.json` 是 AST 唯一事实来源

## 快速开始

### 前置要求

- Node.js + npm
- Rust 工具链 (cargo)
- 可选：`wasm-pack`（重建 WASM）
- 可选：Ollama 或 OpenAI-compatible LLM endpoint

### 安装与运行

```bash
npm install
npm run dev
```

### 环境变量

复制 `.env.example` 为 `.env`（已被 git 忽略）：

| 变量 | 说明 |
|---|---|
| `VITE_BRAIN_MODE` | `mock`（默认）或 `llm` |
| `VITE_LLM_ENDPOINT` | LLM 端点，如 `http://localhost:11434` |
| `VITE_LLM_MODEL` | 模型名，如 `qwen2.5:7b` |
| `VITE_SENTRY_DSN` | Sentry 错误监控（可选） |

> 也可以在 UI 右上角 ⚙️ 设置中配置 LLM，保存到 localStorage，无需重启。

### 快速演示

1. 上传 `.geojson` 文件
2. 输入命令，如 `删除 name 为空的要素，然后导出 GeoJSON`
3. 点击"生成 AST"→ 检查 JSON → "确认执行"
4. 地图预览结果 → 下载

## AST 操作

| Action | 说明 |
|---|---|
| `filter_area` | 按数值字段过滤 |
| `filter_attribute` | 按文本属性过滤（== / != / contains） |
| `drop_empty` | 删除空值要素 |
| `rename_field` | 重命名字段 |
| `transform_crs` | 固定 CRS 转换（WGS84 ↔ GCJ-02 / EPSG:3857） |
| `reproject` | 通用 CRS 转换（任意 EPSG 码，基于 proj4rs） |
| `fix_encoding` | 编码修复（encoding_rs 转码） |
| `simplify` | 几何简化（RDP / VW） |
| `field_calculate` | 字段计算（add/subtract/multiply/divide） |
| `validate_geometry` | 几何校验与修复 |
| `buffer` | 缓冲区 |
| `clip` | 精确裁剪（BooleanOps::intersection） |
| `intersect` | 边界框筛选 |
| `dissolve` | 按字段融合 |
| `export` | 导出（geojson / csv） |
| `noop` | 占位 |
| `need_clarification` | 需要补充信息 |

## 常用脚本

| 命令 | 说明 |
|---|---|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 生产构建 |
| `npm test` | 运行测试 (Vitest) |
| `npm run test:e2e` | Playwright E2E 测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |
| `npm run generate:all` | 从 Schema 生成 TS/Zod/Rust/Prompt |
| `npm run tauri:dev` | Tauri 桌面端开发 |
| `npm run tauri:build` | 构建 Tauri 安装包 (.msi / .exe) |
| `docker compose up --build` | Docker 容器化运行 |

## 测试

| 类型 | 数量 | 工具 |
|---|---|---|
| Rust 单元测试 | 68 | cargo test |
| TypeScript 测试 | 111 | Vitest |
| E2E 测试 | 11 | Playwright (CI) |
| **合计** | **190** | |

CI 流水线 (GitHub Actions):
```
lint + typecheck + unit tests → build ──→ E2E (Playwright)
Rust cargo check + cargo test ────────────┘
```

## 桌面端 (Tauri v2)

```bash
npm run tauri:dev     # 开发
npm run tauri:build   # 打包 → src-tauri/target/release/bundle/
```

打包后生成：
- `bundle/msi/*.msi` — Windows 安装包（推荐分发）
- `bundle/nsis/*-setup.exe` — NSIS 安装包

桌面端增强：
- Rust 后端代理 LLM 请求（API key 不注入前端 JS）
- 原生文件选择对话框
- `read_local_file` command 读取文件字节

## 项目文档

| 文件 | 说明 |
|---|---|
| `DESIGN.md` | UI 设计规范 |
| `ACCEPTANCE.md` | 验收标准与状态 |
| `BUGS.md` | 问题记录与修复历史 |
| `docs/deployment.md` | Docker + Ollama 部署指南 |
| `docs/PRODUCT_DOCUMENTATION.md` | 产品文档 |
| `docs/EXTENSION_GUIDE.md` | 扩展方向与工程准则 |

## 部署

### 静态托管

```bash
npm run build
# 将 dist/ 部署到支持 WASM 的静态托管服务
```

### Docker

```bash
docker compose up --build
# 访问 http://localhost:8080
```

### Tauri 桌面

```bash
npm run tauri:build
# 分发 src-tauri/target/release/bundle/msi/*.msi
```

## 已知限制

- 大型 ZIP Shapefile 生产使用前需用代表性文件验证
- LLM 模式依赖 endpoint 可达性和模型输出质量
- 通用 CRS 转换基于 proj4rs，覆盖 20+ 投影，不及 PROJ C 库完整
- 2026-05-28 前创建的 IndexedDB 历史可能缺少稳定 GeoJSON 内容

详细问题记录见 [BUGS.md](BUGS.md)。

## License

MIT
