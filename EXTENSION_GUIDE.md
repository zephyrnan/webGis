# GeoSurgical 扩展方向与工程准则

本文档用于约束 GeoSurgical WebGIS 后续扩展方向。新增功能、重构 AST、接入真实 GIS 能力、升级 LLM Brain 时，优先以本文档作为判断依据。

## 1. 产品定位

GeoSurgical 的核心不是普通 WebGIS 展示，而是：

> 用自然语言生成可审计 AST，再由本地 Worker + Rust WASM 安全执行空间数据处理。

系统必须坚持三条边界：

- 用户用自然语言描述目标。
- 系统内部只执行结构化、可校验、可回放的 AST。
- 大文件和二进制 GIS 解析不得进入 React 主线程。

## 2. 核心架构原则

### 2.1 AST 是系统契约

AST 是自然语言、前端校验、Worker 协议、Rust 执行引擎之间的唯一契约。

后续不得再手工维护多份互相漂移的 AST 定义。当前项目里 AST 分散在 TS 类型、Zod schema、Rust enum、LLM prompt 中，这是后续扩展的最高优先级风险。

目标方案：

- 新增 `schemas/ast-schema.json` 作为 AST 单一事实来源。
- TypeScript 类型由 JSON Schema 生成。
- Zod 校验由 JSON Schema 或同源代码生成。
- Rust 类型由 schema 生成，或通过测试强制与 schema 对齐。
- LLM prompt 动态嵌入 AST schema 摘要，不手写重复 action 定义。

短期过渡要求：

- 新增任何 action 时，必须同步修改 TS 类型、Zod schema、Rust enum、dispatcher、LLM prompt、测试。
- PR 或提交说明必须列出这几处变更。
- 必须增加一个端到端 AST 样例测试，证明该 action 从生成到执行链路完整。

## 3. 新增 AST Action 准入标准

新增操作例如 `simplify`、`buffer`、`clip`、`intersect`、`field_calculate`，必须满足：

- 有明确输入参数和输出语义。
- 参数可被 JSON Schema 精确表达。
- 校验失败时能返回结构化错误，而不是运行时崩溃。
- Rust dispatcher 有真实实现或显式标记为 unsupported。
- LLM Brain 知道何时生成、何时不要生成。
- UI 能展示风险提示，例如删除要素、改变坐标、修改属性。
- 至少有一个最小样例测试。

推荐 action 结构：

```json
{
  "action": "simplify",
  "tolerance": 0.0001,
  "preserve_topology": true
}
```

不推荐模糊结构：

```json
{
  "action": "process",
  "method": "make it smaller"
}
```

## 4. MVP 假动作落地计划

当前已有若干 MVP 阶段合理存在的占位能力。后续扩展应优先把这些假动作变成真实能力。

### 4.1 WASM Mock 状态显式化

问题：

真实 WASM 加载失败后会回退到 Mock。开发阶段可接受，但生产环境容易误导用户。

改造方向：

- UI 显示当前引擎状态：`real wasm` 或 `mock`。
- Mock 模式下禁止显示为真实处理结果。
- 生产构建可配置为禁止静默 fallback。
- Worker 返回 WASM 加载失败的具体错误。

解决的问题：

- 用户知道当前结果是否可信。
- 开发者能快速定位 WASM 加载、路径、打包问题。

### 4.2 真实取消任务

问题：

当前取消逻辑主要在 JS 调度阶段有效，一旦 Rust/WASM 正在执行，取消不够可靠。

短期方案：

- 用户点击取消时直接 `worker.terminate()`。
- 清理当前任务状态。
- 重新创建 Worker。

长期方案：

- Rust/WASM 支持 cancellation token。
- 大文件处理分块化。
- 每个分块之间检查取消状态并上报进度。

解决的问题：

- 大文件任务不会让用户被动等待。
- UI 的取消按钮具备真实语义。

### 4.3 真实编码转换

问题：

`fix_encoding` 当前更接近日志占位，尚未真正修复 DBF 字符编码。

改造方向：

- Rust 引入 `encoding_rs`。
- 读取 `.cpg` 文件。
- 读取 DBF code page 标识。
- 支持用户手动指定源编码，例如 `GBK`、`windows-1252`、`windows-1256`。
- metadata 中展示编码来源和置信度。

解决的问题：

- Shapefile 属性乱码可以被真实修复。
- `fix_encoding` 从“AST 可识别”升级为“业务可用”。

## 5. LLM Brain 自愈循环

LLM 不能只做一次性翻译。后续应引入内部 Reflection 循环。

目标流程：

1. 用户输入自然语言命令。
2. LLM 生成 AST JSON。
3. 前端用 schema/Zod 校验 AST。
4. 如果校验通过，进入 AST 预览和执行。
5. 如果校验失败，不立即抛给用户。
6. 系统把错误信息、合法字段、合法图层、合法 action 重新发给 LLM。
7. LLM 修正 AST。
8. 最多自动重试 1 次。
9. 仍失败才显示结构化错误给用户。

修正请求应包含：

- 原始用户命令。
- 上一次 LLM 输出的 AST。
- 校验错误。
- 当前 metadata 字段白名单。
- 当前图层白名单。
- 当前 AST schema 摘要。

示例：

```text
你生成的 AST 校验失败。
错误：字段 "population_total" 不存在。
合法字段：["name", "area", "population"]。
请只输出修正后的 JSON，不要解释。
```

解决的问题：

- 减少模型胡编字段、图层、action。
- 用户感知到系统更聪明，而不是频繁报错。
- 保留 AST 安全边界，不让 LLM 直接执行任意逻辑。

## 6. GIS 能力扩展路线

### 阶段 A：基础可信度

优先级最高。

- 修复 UTF-8 文案和文档乱码。
- 显示 real/mock WASM 状态。
- AST schema 单一来源。
- 真实取消任务。
- LLM 自愈重试一次。
- Playwright 覆盖上传、生成 AST、执行、下载的主链路。

### 阶段 B：真实数据处理能力 ✅ 已完成

- ✅ DBF 编码真实转换（encoding_rs + .cpg + DBF LDID 推断，22 种编码映射）。
- ✅ `.prj` 解析增强（AUTHORITY 提取 + 14 种 GEOGCS 名称 + UTM/高斯-克吕格/Web Mercator PROJCS）。
- ✅ CRS 识别置信度（authoritative / heuristic / none，UI badge 显示）。
- ✅ 更多 CRS 转换（WGS-84 → GCJ-02 / EPSG:3857，GCJ-02 → WGS-84）。
- ✅ 原始数据与处理结果对比预览（WebGL 双模式 + 透明度滑块）。
- ✅ 6 语言国际化（zh/en/ja/ko/fr/es）。
- ✅ UI 优化（fade-in 动画、空状态图标、进度条过渡、CommandPalette UX）。
- ✅ E2E 测试（Playwright 覆盖 simplify/validate_geometry/transform_crs/field_calculate/fix_encoding）。

### 阶段 C：空间分析能力

可逐步新增：

- `simplify`：几何抽稀。
- `buffer`：缓冲区。
- `clip`：裁剪。
- `intersect`：相交。
- `dissolve`：按字段融合。
- `field_calculate`：字段计算。
- `reproject`：通用坐标转换。
- `validate_geometry`：几何合法性检查。

每个 action 必须符合第 3 节准入标准。

### 阶段 D：产品化能力

- 保存任务历史。
- 保存 AST 流水线模板。
- 支持批处理。
- 导出 GeoJSON、CSV、Shapefile、MBTiles。
- 数据质量报告。
- 私有化部署配置。
- LLM key 不在前端裸露，改由后端代理或本地模型提供。

## 7. 测试策略

后续测试分四层：

- 单元测试：Brain、AST 校验、快捷命令、formatter。
- Worker 集成测试：上传文件、metadata、执行 AST、错误路径。
- WASM 集成测试：GeoJSON、ZIP Shapefile、DBF 编码、CRS。
- E2E 测试：浏览器上传、生成 AST、确认执行、地图渲染、下载结果。

新增 action 的最低测试要求：

- schema 合法样例。
- schema 非法样例。
- LLM 或 Mock Brain 生成样例。
- Rust dispatcher 执行样例。
- 至少一个用户级流程测试。

## 8. 错误处理规范

所有可预期错误都应返回结构化错误，不应直接抛出不可读异常。

结构化错误至少包含：

- `code`
- `message`
- `recoverable`
- `suggestedUserInput`，可选
- `details`，可选

常见错误类型：

- 文件类型不支持。
- metadata 未准备好。
- AST schema 不合法。
- 字段不存在。
- 图层不存在。
- CRS 转换不支持。
- 编码不支持。
- WASM 加载失败。
- 任务被取消。

## 9. 扩展决策清单

每次新增功能前，先回答：

- 它解决用户什么真实问题？
- 是否必须新增 AST action？
- 能否用现有 action 组合完成？
- 参数是否能被 schema 精确约束？
- 是否会修改几何、属性、CRS 或编码？
- 是否需要风险提示？
- 是否需要撤销或回放能力？
- 是否影响大文件性能？
- 是否需要 LLM prompt 更新？
- 是否需要 Rust/WASM 实现？
- 是否有测试样例？

答不清楚的问题，不进入实现。

## 10. 当前最高优先级建议

建议后续按这个顺序推进：

1. 新建 `schemas/ast-schema.json`，收敛 AST 契约。
2. 修复中文乱码和 i18n 文案来源。
3. UI 显示 WASM real/mock 状态。
4. 实现取消任务时 terminate 并重建 Worker。
5. 给 LLM Brain 增加一次自愈重试。
6. 让 `fix_encoding` 接入真实 DBF 编码转换。
7. 增加 Playwright 主链路测试。

这 7 项完成后，再开始扩展 `simplify`、`buffer`、`clip` 等空间分析能力。
