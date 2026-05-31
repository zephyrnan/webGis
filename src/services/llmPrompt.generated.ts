// This file is auto-generated from schemas/ast-schema.json — do not edit manually.
// Run: npm run generate:prompt

export const AVAILABLE_ACTIONS = `- filter_area: 按数值字段过滤要素。参数: field, operator (>=/>/<=/</=), value
- filter_attribute: 按文本属性字段过滤要素。参数: field, operator (==/!=/contains), value
- drop_empty: 删除指定字段为空的要素。参数: field
- rename_field: 重命名字段。参数: from, to
- transform_crs: 坐标系转换（当前支持 WGS-84 → GCJ-02）。参数: from, to (GCJ-02/EPSG:4326/EPSG:3857)
- reproject: 通用坐标系转换（基于 EPSG 码，支持任意 proj4rs 兼容的坐标系对，如 UTM、LCC、Mercator 等）。参数: from_epsg, to_epsg
- fix_encoding: 编码修复（将属性值从源编码转换为 UTF-8）。参数: from, to (utf-8)
- simplify: 几何抽稀（Ramer-Douglas-Peucker 算法减少顶点数量）。参数: tolerance, preserve_topology [可选]
- field_calculate: 字段计算（对两个操作数执行算术运算，结果写入目标字段）。参数: target_field, operation (add/subtract/multiply/divide), operands
- validate_geometry: 几何校验（检查几何合法性，可选自动修复）。参数: mode (check/check_and_fix)
- buffer: 缓冲区（对几何生成缓冲区，圆弧近似）。参数: distance, segments [可选]
- clip: 精确裁剪（对 Polygon/MultiPolygon 执行几何相交运算，输出被截断到 bbox 边界内）。参数: bbox
- intersect: 边界框筛选（保留与 bbox 相交的要素，不修改原始几何）。参数: bbox
- dissolve: 融合（按字段值分组，合并多边形几何）。参数: field
- export: 导出处理结果。参数: format (geojson/csv)
- noop: 无法执行时的占位符。参数: reason
- need_clarification: 需要用户补充信息。参数: reason`;

export const ACTION_NAMES = ["filter_area","filter_attribute","drop_empty","rename_field","transform_crs","reproject","fix_encoding","simplify","field_calculate","validate_geometry","buffer","clip","intersect","dissolve","export","noop","need_clarification"];
