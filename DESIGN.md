# 设计规范

## 产品 UI 目标

GeoSurgical 是一个空间数据处理工作台。界面应像一个干净、聚焦、精确的开发者控制台：明亮、克制、高效，每个像素都服务于上传、检查、下达命令和导出空间数据的工作流。

## 风格方向

- 方向：克制明亮的工具型仪表盘。
- 参考：Linear 浅色模式、Vercel Dashboard 浅色模式、GitHub Light。
- 视觉气质：白色背景、zinc 灰阶界面、深色文字和操作强调。不使用装饰性色彩，颜色只用于功能状态：成功、警告、错误。

## 设计原则

1. 无全局滚动。页面使用 `h-screen w-full overflow-hidden`，只允许局部面板滚动。
2. 三栏网格布局（`grid-cols-12`）：数据流 3 栏、可视化 5 栏、控制流 4 栏。
3. 灰阶优先。颜色只用于状态信号：成功（emerald）、警告（amber）、错误（red）、激活（zinc border）。
4. 高信息密度。使用 10-12px 小字号、紧凑 padding 和最小 gap。这是面向高频操作用户的工具。
5. 数据使用等宽字体。文件名、字段名、AST、命令、技术值使用 `font-mono`。

## 颜色 Token

- 应用背景：`#ffffff`（white）
- 面板表面：`zinc-50`（`#fafafa`）
- 内层表面：`zinc-100`（`#f4f4f5`）
- 边框：`zinc-200`（`#e4e4e7`），激活态 `zinc-300`（`#d4d4d8`）
- 主文本：`zinc-900`（`#18181b`）
- 次级文本：`zinc-600`（`#52525b`）
- 弱化文本：`zinc-400`（`#a1a1aa`）
- 主操作色：`zinc-900` 背景 + `white` 文本（反色按钮）
- 成功：`emerald-500` / `emerald-700`
- 警告：`amber-500` / `amber-700`
- 错误：`red-500` / `red-700`

## 字体与排版

- 字体：Inter 或系统 sans-serif 字体栈。
- 页面标题：`text-sm font-semibold`，紧凑 header。
- 面板标题：`text-xs font-medium text-zinc-600`。
- 正文/元数据：`text-[11px]` 或 `text-xs`。
- 等宽值：`font-mono text-[11px]`。
- 标签：`text-[10px] text-zinc-400 uppercase tracking-wider`。

## 布局规则

- 全视口：`h-screen w-full flex flex-col overflow-hidden`。
- Header：`shrink-0`，紧凑高度（`py-2.5`），只保留下边框。
- Main：`flex-1 min-h-0 grid grid-cols-12 gap-px bg-zinc-200`。
- 左侧（`col-span-3`）：文件上传 + 图层树 + 批处理。图层树局部滚动。
- 中间（`col-span-5`）：地图画布填满剩余空间（`flex-1 min-h-0`）。
- 右侧（`col-span-4`）：命令面板（`shrink-0`）+ AST/进度（可滚动）+ 历史/结果（`max-h-45vh` 局部滚动）。
- `gap-px` 搭配 `bg-zinc-200` 形成细微 1px 分隔线。
- 不使用 `rounded-3xl`，卡片只使用 `rounded-lg` 或 `rounded-md`。

## 组件规则

- 按钮：`rounded-md`，紧凑 padding。主按钮 = `zinc-900` 背景 + 白色文字；次按钮 = `zinc-300` 边框 + `zinc-600` 文本。
- 输入框：`bg-white border-zinc-300`，技术输入使用等宽字体，`focus:border-zinc-400`。
- 卡片：`rounded-lg border border-zinc-200 bg-zinc-50 p-3`。
- 表格：紧凑行高（约 32px），sticky header，大数据表使用虚拟化。
- 地图：填满中间栏，OpenLayers 控件使用浅色覆盖样式。
- 进度：1px 细线，`zinc-900` 进度填充，`zinc-200` 轨道。
- 错误提示：`border-amber-300 bg-amber-50 text-amber-700`，不只依赖 toast。
- 图层树：用 `border-l border-zinc-200 ml-5 pl-3` 表达层级缩进。

## 交互状态

- Hover：加深边框或文字，不产生布局位移。
- Focus：输入框使用 `border-zinc-400`，不使用强彩色 ring。
- 可访问性：所有图标按钮必须有 accessible label；toggle 暴露 `aria-pressed`；折叠控件暴露 `aria-expanded`；可排序表格使用真实 button 和 `aria-sort`。
- Loading：使用 spinner 或进度条，控件保持可见但 disabled。
- Error：使用内联 callout，不能只用 toast。
- Disabled：使用 `opacity-40` 或 `text-zinc-300`。

## 可以做 / 不要做

### 可以做

- 保持布局锁定在视口高度。
- 所有技术值和数据值使用等宽字体。
- Header 中显示 WASM / Mock 模式 badge。
- AST 以可审计 JSON 展示在可滚动 pre 块中。
- 只在具体面板使用 `overflow-y-auto`，不要让 body 滚动。

### 不要做

- 不添加全局滚动条。
- 不使用装饰性渐变或超大圆角卡片。
- 非状态元素不使用彩色背景。
- 不添加干扰数据检查的动画。
