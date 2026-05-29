// This file is auto-generated from schemas/ast-schema.json — do not edit manually.
// Run: npm run generate:types

/**
 * 所有可用的 GeoSurgical 操作
 */
export type Operation =
  | FilterArea
  | FilterAttribute
  | DropEmpty
  | RenameField
  | TransformCrs
  | FixEncoding
  | Simplify
  | FieldCalculate
  | ValidateGeometry
  | Buffer
  | Clip
  | Intersect
  | Dissolve
  | Export
  | Noop
  | NeedClarification;

/**
 * GeoSurgical AST 是自然语言、前端校验、Worker 协议、Rust 执行引擎之间的唯一契约。新增 action 时必须同步更新：本文件、src/types/ast.ts、src/services/astValidation.ts (Zod)、src-wasm/src/types.rs (Rust enum)、src/services/llmBrain.ts (LLM prompt)。
 */
export interface GeoSurgicalAST {
  /**
   * AST 协议版本，当前固定为 1.0
   */
  version: "1.0";
  /**
   * 按顺序执行的操作列表
   *
   * @minItems 1
   */
  operations: Operation[];
  /**
   * 目标图层名称（可选，多图层 ZIP Shapefile 时使用）
   */
  target_layer?: string;
}
/**
 * 按数值字段过滤要素
 */
export interface FilterArea {
  action: "filter_area";
  /**
   * 要过滤的数值字段名
   */
  field: string;
  /**
   * 比较运算符
   */
  operator: ">=" | ">" | "<=" | "<" | "=";
  /**
   * 比较阈值
   */
  value: number;
}
/**
 * 按文本属性字段过滤要素
 */
export interface FilterAttribute {
  action: "filter_attribute";
  /**
   * 要过滤的字段名
   */
  field: string;
  /**
   * 文本比较运算符
   */
  operator: "==" | "!=" | "contains";
  /**
   * 要匹配的文本值
   */
  value: string;
}
/**
 * 删除指定字段为空的要素
 */
export interface DropEmpty {
  action: "drop_empty";
  /**
   * 要检查的字段名
   */
  field: string;
}
/**
 * 重命名字段
 */
export interface RenameField {
  action: "rename_field";
  /**
   * 原字段名
   */
  from: string;
  /**
   * 新字段名
   */
  to: string;
}
/**
 * 坐标系转换（当前支持 WGS-84 → GCJ-02）
 */
export interface TransformCrs {
  action: "transform_crs";
  /**
   * 源坐标系，如 EPSG:4326
   */
  from: string;
  /**
   * 目标坐标系
   */
  to: "GCJ-02" | "EPSG:4326" | "EPSG:3857";
}
/**
 * 编码修复（将属性值从源编码转换为 UTF-8）
 */
export interface FixEncoding {
  action: "fix_encoding";
  /**
   * 源编码，如 GBK、windows-1256
   */
  from: string;
  /**
   * 目标编码，当前只支持 utf-8
   */
  to: "utf-8";
}
/**
 * 几何抽稀（Ramer-Douglas-Peucker 算法减少顶点数量）
 */
export interface Simplify {
  action: "simplify";
  /**
   * 抽稀容差，单位与坐标系一致（度或米），如 0.0001
   */
  tolerance: number;
  /**
   * 是否保持拓扑关系，默认 true
   */
  preserve_topology?: boolean;
}
/**
 * 字段计算（对两个操作数执行算术运算，结果写入目标字段）
 */
export interface FieldCalculate {
  action: "field_calculate";
  /**
   * 结果写入的字段名（新建或覆盖）
   */
  target_field: string;
  /**
   * 算术运算类型
   */
  operation: "add" | "subtract" | "multiply" | "divide";
  /**
   * 两个操作数，可以是字段名或数字字面量
   *
   * @minItems 2
   * @maxItems 2
   */
  operands: [string, string];
}
/**
 * 几何校验（检查几何合法性，可选自动修复）
 */
export interface ValidateGeometry {
  action: "validate_geometry";
  /**
   * check 仅检查，check_and_fix 检查并尝试修复
   */
  mode: "check" | "check_and_fix";
}
/**
 * 缓冲区（对几何生成缓冲区，圆弧近似）
 */
export interface Buffer {
  action: "buffer";
  /**
   * 缓冲距离，单位与坐标系一致
   */
  distance: number;
  /**
   * 圆弧分段数，默认 32
   */
  segments?: number;
}
/**
 * 裁剪（按边界框裁剪，保留 bbox 内的要素）
 */
export interface Clip {
  action: "clip";
  /**
   * [min_x, min_y, max_x, max_y]
   *
   * @minItems 4
   * @maxItems 4
   */
  bbox: [number, number, number, number];
}
/**
 * 相交（按边界框筛选，保留与 bbox 相交的要素）
 */
export interface Intersect {
  action: "intersect";
  /**
   * [min_x, min_y, max_x, max_y]
   *
   * @minItems 4
   * @maxItems 4
   */
  bbox: [number, number, number, number];
}
/**
 * 融合（按字段值分组，合并多边形几何）
 */
export interface Dissolve {
  action: "dissolve";
  /**
   * 分组字段名
   */
  field: string;
}
/**
 * 导出处理结果
 */
export interface Export {
  action: "export";
  /**
   * 导出格式
   */
  format: "geojson" | "csv";
}
/**
 * 无法执行时的占位符
 */
export interface Noop {
  action: "noop";
  /**
   * 无法执行的原因
   */
  reason: string;
}
/**
 * 需要用户补充信息
 */
export interface NeedClarification {
  action: "need_clarification";
  /**
   * 需要澄清的原因
   */
  reason: string;
}
