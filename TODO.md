# GeoSurgical WebGIS — 待办计划

> 最后更新：2026-05-31。P0 测试 + P1.3 rename_field 已完成。

---

## 已完成

| 编号 | 任务 | 状态 |
|------|------|------|
| P0.1 | Rust 单元测试 (62 tests) | ✅ |
| P0.2 | E2E 测试接入 CI (11 tests) | ✅ |
| P0.3 | 集成测试覆盖 (28 tests) | ✅ |
| P1.3 | Mock Brain rename_field (5 tests) | ✅ |

---

## 待完成

### P2.2 LLM 响应解析健壮性

**耗时：15 分钟 · 收益：容错率提升一个维度**

- **现状**：`extractJsonObject` 用 `indexOf('{')` 到 `lastIndexOf('}')` 提取 JSON，遇到 markdown 代码块、trailing comma、解释文本时直接 `JSON.parse` 崩溃
- **目标**：让系统能处理真实 LLM 的各种"加戏"输出
- **范围**：
  - [ ] 优先提取 `` ```json `` / `` ``` `` 代码块内容
  - [ ] 回退到正则匹配最外层 `{...}`
  - [ ] 修复常见格式问题：trailing comma、单引号、注释
  - [ ] 支持数组形式 AST pipeline `[{...}, {...}]`
  - [ ] 解析失败时返回结构化错误（含建议文案）
  - [ ] 用多种真实 LLM 输出编写单元测试
- **涉及文件**：`src/services/llmBrain.ts`
- **验证**：`npm test` 新增 8~10 个解析测试全部通过

---

### P3.2 LLM 模型选择器

**耗时：1 小时 · 收益：降低其他用户体验门槛**

- **现状**：LLM 配置通过 `.env` 或 Tauri 后端固定，普通用户无法切换
- **目标**：UI 中可直接切换 LLM provider 并填入自己的 API Key
- **范围**：
  - [ ] 右上角设置下拉框：Mock / Ollama (Local) / OpenAI-compatible / SiliconFlow
  - [ ] API Key 输入框 + 保存到 localStorage（不持久化到磁盘）
  - [ ] Endpoint URL 输入框（Ollama 默认 `http://localhost:11434`）
  - [ ] 模型名称输入框（Ollama 默认 `qwen2.5-coder`）
  - [ ] 配置变更后立即生效，无需刷新
  - [ ] 首次打开时自动检测 `.env` 已有配置并回填
- **涉及文件**：新增 `src/components/LlmSettings.tsx`，修改 `AppShell.tsx`、`llmBrain.ts`
- **验证**：手动切换 provider → 输入命令 → 验证走的是对应 endpoint

---

### P2.1 批处理 Worker Pool 并行化

**耗时：半天 · 收益：面试王炸级亮点**

- **现状**：批处理对每个文件串行创建 Worker 执行，10 个文件需要 10 倍时间
- **目标**：升级为 Worker Pool 架构，并发处理多文件
- **范围**：
  - [ ] 新增 `src/workers/workerPool.ts`：基于 `navigator.hardwareConcurrency` 创建 Worker 池
  - [ ] 任务队列：FIFO 调度，Worker 空闲时自动领取下一个任务
  - [ ] 并发数 = `Math.min(4, hardwareConcurrency - 1)`，至少 1 个
  - [ ] 每个文件独立 Worker 上下文，互不干扰
  - [ ] 进度 UI 改为多文件网格，每个文件显示独立进度条
  - [ ] Worker 异常时自动重试 1 次，仍失败则标记该文件为 error 并继续下一个
  - [ ] 取消批处理时终止所有 Worker
- **涉及文件**：新增 `src/workers/workerPool.ts`，修改 `src/hooks/useBatchProcessor.ts`、`src/components/BatchPanel.tsx`
- **验证**：批处理 5 个文件，观察总耗时是否接近单文件耗时（而非 5 倍）

---

### P1.1 真正多边形裁剪 (Clip ≠ Intersect)

**耗时：半天 · 收益：捍卫 GIS 专业性**

- **现状**：clip 和 intersect 都用 `geojson_bbox_intersects` 做 bbox 碰撞检测，行为完全相同。GIS 工程师一眼看穿
- **目标**：clip 实现真正的多边形相交裁剪（输出要素被裁剪到 bbox 边界内），intersect 保留 bbox 筛选
- **方案**：利用已有的 `geo::BooleanOps` trait（项目已依赖 `geo` crate），对 Polygon/MultiPolygon 做 intersection 运算
- **范围**：
  - [ ] `src-wasm/src/ops/geometry.rs` 新增 `clip_polygon_to_bbox` 函数：构造 bbox 矩形 → `BooleanOps::intersection`
  - [ ] dispatcher clip 分支：对 Polygon/MultiPolygon 做真裁剪，Point/LineString 保留 bbox 筛选
  - [ ] 更新 LLM prompt 区分 clip（精确裁剪）和 intersect（bbox 筛选）
  - [ ] 补充 Rust 单元测试：部分重叠多边形裁剪后面积 < 原面积
- **涉及文件**：`src-wasm/src/ops/geometry.rs`、`src-wasm/src/dispatcher.rs`、`src/services/llmBrain.ts`
- **验证**：`cargo test` 新增裁剪测试 + 手动用大 bbox 验证部分裁剪效果

---

## 状态追踪

| 编号 | 任务 | 状态 | 耗时 |
|------|------|------|------|
| P2.2 | LLM 解析健壮性 | ✅ 已完成 (27 tests) | 15 分钟 |
| P3.2 | LLM 模型选择器 | ✅ 已完成 | 1 小时 |
| P2.1 | Worker Pool 并行化 | ✅ 已完成 (3 tests) | 半天 |
| P1.1 | 真正多边形裁剪 | ✅ 已完成 (3 tests) | 半天 |

## 推荐执行顺序

1. **P2.2**（15 分钟）— 投入产出比最高，立刻提升系统鲁棒性
2. **P3.2**（1 小时）— 降低使用门槛，开源/分享必备
3. **P2.1**（半天）— 面试王炸，"前端并发 + WASM 线程池"是 T0 级亮点
4. **P1.1**（半天）— 专业底线，让 GIS 内行无可挑剔
