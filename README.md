# GeoSurgical WebGIS

GeoSurgical 是一个面向空间数据的语言驱动"手术台"。用户上传 GIS 文件后，系统先在本地 Worker 中完成元数据分诊，再通过自然语言生成可审计的 GeoSurgical AST，最后由 Rust WASM 引擎执行清洗、筛选、坐标转换、导出等操作，并在地图上预览结果。

完整链路：上传文件 → Rust WASM 提取 metadata → 生成快捷指令 → LLM/关键词生成 AST → AST 校验 → Rust WASM 执行 → WebGL 地图预览 → 下载/复制 GeoJSON。

## 功能特性

- 支持上传 `.geojson`、`.json`、`.zip` Shapefile 文件。
- 使用 Web Worker 接管文件 `ArrayBuffer`，主线程不做任何二进制解析。
- **Rust WASM 引擎**：真实 GeoJSON/ZIP Shapefile 解析、元数据提取、BBox 计算、CRS 检测。
- **`.prj` 投影解析**：读取 ZIP 中的 `.prj` 文件，解析 WKT 提取 EPSG 代码。
- **`.cpg` 编码感知**：读取 ZIP 中的 `.cpg` 文件，用真实编码（GBK、Windows-1256 等）转码 DBF 字段名和值。
- **AST Dispatcher**：支持 `filter_area`、`drop_empty`、`rename_field`、`transform_crs`（WGS-84 → GCJ-02 / EPSG:3857、GCJ-02 → WGS-84）、`fix_encoding`、`simplify`、`field_calculate`、`validate_geometry`、`buffer`（缓冲区）、`clip`（裁剪）、`intersect`（相交）、`dissolve`（融合）、`export`。
- **fix_encoding 真实转码**：从 ZIP 重新读取原始 DBF 字节，用指定编码做字节级转码。
- **DBF LDID 编码推断**：无 `.cpg` 时从 DBF Header 字节 29 推断编码（22 种 LDID 映射）。
- **CRS 置信度**：区分 `authoritative`（.prj AUTHORITY）、`heuristic`（WKT 名称推测）、`none`。
- **`.prj` WKT 增强解析**：支持 UTM Zone、中国高斯-克吕格、Web Mercator、日韩坐标系等 14+ 种模式。
- **LLM Brain**：支持 Ollama 本地模型或 OpenAI/DeepSeek 兼容 API，自动翻译自然语言为 AST。
- **Mock Brain**：无需 LLM 服务，关键词匹配模式作为 fallback。
- 使用 Zod 对 AST 进行白名单和字段合法性校验。
- Worker 执行 AST 并回传进度心跳、结构化错误、结果和撤销能力。
- **WebGL 渲染**：OpenLayers WebGL 模式支持大数据量高性能渲染，原始图层同样支持 WebGL。
- **前后对比**：地图支持切换显示原始数据与处理结果，透明度滑块控制混合效果。
- 支持下载处理后的 GeoJSON 文件和一键复制 JSON。
- **6 语言国际化**：中文、English、日本語、한국어、Français、Español，自动检测浏览器语言。
- **UI 动画**：面板出现 fade-in 动画、进度条平滑过渡、空状态 lucide 图标。
- **E2E 测试**：Playwright 覆盖上传、AST 生成、执行、CRS 转换、字段计算等主链路。

## 技术栈

| 层 | 技术 |
|---|------|
| 前端 | Vite + React 19 + TypeScript + Tailwind CSS v4 |
| 地图 | OpenLayers (WebGL + Canvas 双模式) |
| WASM 引擎 | Rust + wasm-bindgen + serde + geojson crate |
| 计算隔离 | Web Worker + Transferable Objects |
| LLM | Ollama / OpenAI-compatible API |
| 校验 | Zod |
| 测试 | Vitest |

## 架构说明

```text
┌─────────────────────────────────────────────────────┐
│  React 主线程 (UI only)                              │
│  Dropzone → MetadataPanel → CommandPalette → Map    │
└────────────┬──────────────────────────┬─────────────┘
             │ Transferable             │ AST (JSON)
             │ ArrayBuffer              │
┌────────────▼──────────────────────────▼─────────────┐
│  Web Worker                                         │
│  ┌─────────────────┐  ┌───────────────────────────┐ │
│  │ Rust WASM       │  │ AST Dispatcher            │ │
│  │ extract_metadata│  │ filter_area / drop_empty  │ │
│  │ (GeoJSON parse) │  │ simplify / field_calc     │ │
│  └─────────────────┘  │ validate_geometry / ...   │ │
│                        └───────────────────────────┘ │
└─────────────────────────────────────────────────────┘
             ▲
┌────────────┴───────────────────────────────────────┐
│  LLM Brain (可选)                                    │
│  Ollama / DeepSeek / OpenAI                         │
│  输入: 自然语言 + Metadata (不含真实坐标)              │
│  输出: GeoSurgical AST JSON                          │
└────────────────────────────────────────────────────┘
```

核心原则：
- 主线程不拆包：任何二进制解析都不进入 React 主线程。
- Buffer 所有权单行道：`ArrayBuffer` transfer 给 Worker 后，主线程不能再读写。
- LLM 只看摘要：大模型只接收 Metadata 和用户指令，不接收原始坐标。
- AST 可审计：所有操作都是可校验、可回放的 JSON 指令。

核心目录：

```text
src/
  components/        UI 组件 (AppShell, Dropzone, CommandPalette, MapPreview, ResultPanel 等)
  hooks/             Worker 生命周期 Hook
  i18n/              6 语言国际化 (zh/en/ja/ko/fr/es)
  services/          Brain (Mock + LLM)、AST 校验、快捷指令
  types/             Metadata、AST、Worker 协议类型
  wasm/              WASM 接口、Mock 实现、真实 WASM 加载器
  workers/           GeoSurgical Worker
src-wasm/            Rust WASM 源码 (wasm-bindgen + geojson + geo + encoding_rs)
  src/
    lib.rs           入口：GeoSurgicalEngine
    metadata.rs      extract_metadata 实现（含 .prj/.cpg 解析）
    dispatcher.rs    AST Dispatcher + GCJ-02 坐标转换 + fix_encoding 真实转码
    types.rs         Rust 侧类型定义
```

## 快速开始

### 环境要求

- Node.js 20+
- npm
- Rust + wasm-pack（可选，用于重新编译 WASM 模块）

### 安装依赖

```bash
npm install
```

### 配置 LLM（可选）

复制 `.env.example` 为 `.env`，配置 LLM 服务：

```bash
# 使用本地 Ollama
VITE_BRAIN_MODE=llm
VITE_LLM_ENDPOINT=http://localhost:11434
VITE_LLM_MODEL=qwen2.5:7b

# 或使用 DeepSeek API
VITE_BRAIN_MODE=llm
VITE_LLM_ENDPOINT=https://api.deepseek.com
VITE_LLM_API_KEY=sk-xxx
VITE_LLM_MODEL=deepseek-chat
```

不配置 `.env` 时默认使用关键词匹配 Mock Brain。

### 启动开发服务器

```bash
npm run dev
```

### 生产构建

```bash
npm run build
```

### 重新编译 Rust WASM（可选）

```bash
cd src-wasm
wasm-pack build --target web --release
```

## 可用脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动开发服务器 |
| `npm run build` | 类型检查并构建生产包 |
| `npm run preview` | 本地预览生产构建 |
| `npm run test` | 运行单元测试 |
| `npm run test:watch` | watch 模式运行测试 |
| `npm run typecheck` | TypeScript 类型检查 |
| `npm run lint` | ESLint |

## 使用流程

1. 打开页面，上传 `.geojson`、`.json` 或 `.zip` Shapefile 文件。
2. Rust WASM 自动提取 Metadata（字段、BBox、CRS、要素数量）。
3. 点击系统生成的快捷指令，或输入自然语言命令。
4. 点击"生成 AST"（LLM 模式调用大模型，Mock 模式关键词匹配）。
5. 检查 AST 和风险提示。
6. 点击"确认执行"，Rust WASM 在 Worker 中处理数据。
7. 地图自动渲染结果，支持 WebGL/Canvas 模式切换。
8. 下载或复制处理后的 GeoJSON。

## 示例指令

```text
删除 name 字段为空的要素，然后导出 GeoJSON。
清理 area 为 0 的废弃多边形，然后导出 GeoJSON。
把坐标从 EPSG:4326 转成火星坐标，然后导出 GeoJSON。
简化几何，容差 0.0001，然后导出 GeoJSON。
计算 density = population / area，然后导出 GeoJSON。
校验几何并修复，然后导出 GeoJSON。
```

## 当前支持的 AST 操作

| Action | 说明 | 参数 |
|--------|------|------|
| `filter_area` | 按数值字段过滤 | field, operator, value |
| `drop_empty` | 删除空值要素 | field |
| `rename_field` | 重命名字段 | from, to |
| `transform_crs` | 坐标转换 (4326→GCJ-02 / 4326→3857 / GCJ-02→4326) | from, to |
| `fix_encoding` | 编码修复指令 | from, to |
| `simplify` | 几何抽稀 (RDP 算法) | tolerance, preserve_topology |
| `field_calculate` | 字段计算 | target_field, operation, operands |
| `validate_geometry` | 几何校验/修复 | mode (check / check_and_fix) |
| `buffer` | 缓冲区（圆弧近似） | distance, segments |
| `clip` | 裁剪（按 bbox） | bbox [min_x, min_y, max_x, max_y] |
| `intersect` | 相交（按 bbox 筛选） | bbox [min_x, min_y, max_x, max_y] |
| `dissolve` | 按字段融合多边形 | field |
| `export` | 导出结果 | format |

## 已验证

- `npm run typecheck` 通过。
- `npm run test` 通过（7 个测试用例）。
- `npm run build` 通过，WASM 模块和 Worker 正确打包。
- Rust WASM 编译通过 (`wasm-pack build --target web --release`)。
- 使用 `F:\浏览器下载\lebanon-260514-free.shp.zip` 验证：metadata 识别为 `shapefile_zip`，执行 `fix_encoding + export` 输出 1114 个 GeoJSON 要素。
- `.prj` 解析：支持 WKT 中 `AUTHORITY["EPSG","XXXX"]` 提取和常见坐标系名称映射。
- `.cpg` 编码转码：支持 GBK、Windows-1256、Shift-JIS 等编码的 DBF 字段名和值转码。
- `simplify` 几何抽稀：RDP 算法，支持 LineString / Polygon / MultiLineString / MultiPolygon。
- `field_calculate` 字段计算：add / subtract / multiply / divide，支持字段名和数字字面量。
- `validate_geometry` 几何校验：check 模式检查，check_and_fix 模式修复未闭合环、NaN 坐标、重复点。

## 注意事项

- WASM 模块通过 Vite alias `@wasm/geosurgical` 导入（见 `vite.config.ts`），解决 Vite 8 Worker 内嵌套动态导入路径解析问题。
- `tsconfig.app.json` 中配置了对应的 `paths` 映射，TypeScript 类型自动关联到 `src-wasm/pkg/geosurgical_wasm.d.ts`。

## 后续迭代方向

- 完整 PROJ 坐标系转换引擎（当前支持 WGS-84 → GCJ-02 / EPSG:3857、GCJ-02 → WGS-84）。
- 阶段 D 产品化能力：任务历史、AST 模板、批处理、更多导出格式。
- 流式 LLM 响应（SSE）。
- 更完整的撤销系统（快照 + 回放）。
- 部署流水线。
