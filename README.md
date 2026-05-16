# GeoSurgical WebGIS

GeoSurgical 是一个面向空间数据的语言驱动“手术台”MVP。用户上传 GIS 文件后，系统先在本地 Worker 中完成元数据分诊，再通过自然语言生成可审计的 GeoSurgical AST，最后由 Worker 执行清洗、筛选、导出等操作，并在地图上预览结果。

当前版本重点验证完整产品链路：上传文件 → 提取 metadata → 生成快捷指令 → 自然语言生成 AST → AST 校验 → Worker 执行 → 结果预览 → 下载 GeoJSON。

## 功能特性

- 支持上传 `.geojson`、`.json`、`.zip`、`.shp` 文件。
- 使用 Web Worker 接管文件 `ArrayBuffer`，避免主线程处理重计算。
- Metadata Dry Run：展示文件类型、要素估计、字段摘要、BBox、CRS、编码和 warning。
- 根据 metadata 生成动态快捷指令。
- 通过自然语言命令生成 GeoSurgical AST。
- 使用 Zod 对 AST 进行白名单和字段合法性校验。
- Worker 执行 AST 并回传进度、结构化错误、结果和撤销能力。
- 使用 OpenLayers 预览 GeoJSON 结果。
- 支持下载处理后的 GeoJSON 文件。

## 技术栈

- Vite
- React 19
- TypeScript
- Tailwind CSS v4
- OpenLayers
- Web Worker
- Zod
- Vitest
- Mock WASM Adapter

## 架构说明

项目遵循本地优先和隐私保护原则：

- React 主线程只负责 UI、文件接收、`File.arrayBuffer()` 和消息调度。
- 原始文件 buffer 通过 Transferable Object 传给 Worker。
- Worker 持有任务上下文，并负责 metadata dry run 和 AST 执行。
- Brain/LLM 层只接收用户命令、metadata 和 AST schema，不接收原始文件、完整坐标、完整属性表或 `ArrayBuffer`。
- 当前 Rust WASM 尚未接入，`src/wasm/geosurgicalMock.ts` 提供 TypeScript mock 实现。

核心目录：

```text
src/
  components/        UI 组件
  hooks/             Worker 生命周期 Hook
  services/          Brain mock、AST 校验、快捷指令等服务
  types/             Metadata、AST、Worker 协议类型
  wasm/              WASM 接口与 mock 实现
  workers/           GeoSurgical Worker
```

## 快速开始

### 环境要求

- Node.js 20+ 推荐
- npm

### 安装依赖

```bash
npm install
```

### 启动开发服务器

```bash
npm run dev
```

启动后访问 Vite 输出的本地地址，通常是：

```text
http://localhost:5173/
```

### 生产构建

```bash
npm run build
```

### 预览生产构建

```bash
npm run preview
```

## 可用脚本

```bash
npm run dev          # 启动开发服务器
npm run build        # 类型检查并构建生产包
npm run preview      # 本地预览生产构建
npm run test         # 运行单元测试
npm run test:watch   # 以 watch 模式运行测试
npm run typecheck    # 运行 TypeScript 类型检查
npm run lint         # 运行 ESLint
```

## 使用流程

1. 打开页面。
2. 上传 `.geojson` 或 `.json` 文件。
3. 等待 Metadata Dry Run 完成。
4. 点击系统生成的快捷指令，或手动输入自然语言命令。
5. 点击“生成 AST”。
6. 检查 AST 和风险提示。
7. 点击“确认执行”。
8. 在右侧地图预览结果。
9. 点击“下载 GeoJSON”保存处理结果。

## 示例指令

```text
删除 name 字段为空的要素，然后导出 GeoJSON。
```

```text
清理 area 为 0 的废弃多边形，然后导出 GeoJSON。
```

```text
一键纠偏至火星坐标，然后导出 GeoJSON。
```

## 当前 MVP 边界

当前版本是可演示 MVP，不是完整 GIS 生产引擎：

- `.geojson` / `.json` 支持 mock 解析和基础处理。
- `.zip` / `.shp` 只返回 mock metadata 和 warning，不做真实 Shapefile/DBF 解析。
- `transform_crs` 当前仅作为链路演示记录，不执行真实坐标转换。
- Rust WASM、真实 zip 解压、真实 Shapefile 解析、GBK 编码处理和大文件优化留待后续迭代。

## 已验证

当前 MVP 已完成以下验证：

- `npm run typecheck` 通过。
- `npm run test` 通过。
- `npm run build` 通过。
- 浏览器手动验证通过：上传 GeoJSON、生成 AST、Worker 执行、OpenLayers 预览、下载结果。

构建时可能出现 OpenLayers bundle 超过 500KB 的提示。这不影响当前功能，后续可通过动态导入或代码分包优化。

## 后续迭代方向

- 接入真实 Rust WASM。
- 支持真实 `.zip` 解压和 Shapefile/DBF 解析。
- 支持 GBK 编码识别与字段名恢复。
- 支持真实 CRS 转换。
- 优化大文件处理和地图渲染性能。
- 接入真实 LLM 或本地 Ollama。
- 增加更完整的撤销系统。
- 增加部署流水线。
