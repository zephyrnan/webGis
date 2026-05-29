// This file is auto-generated from schemas/ast-schema.json — do not edit manually.
// Run: npm run generate:zod
import { z } from 'zod';

export const operationSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal("filter_area"),
    field: z.string().min(1),
    operator: z.enum([">=",">","<=","<","="]),
    value: z.number().finite(),
  }),
  z.object({
    action: z.literal("filter_attribute"),
    field: z.string(),
    operator: z.enum(["==","!=","contains"]),
    value: z.string(),
  }),
  z.object({
    action: z.literal("drop_empty"),
    field: z.string().min(1),
  }),
  z.object({
    action: z.literal("rename_field"),
    from: z.string().min(1),
    to: z.string().min(1),
  }),
  z.object({
    action: z.literal("transform_crs"),
    from: z.string().min(1),
    to: z.enum(["GCJ-02","EPSG:4326","EPSG:3857"]),
  }),
  z.object({
    action: z.literal("fix_encoding"),
    from: z.string().min(1),
    to: z.enum(["utf-8"]),
  }),
  z.object({
    action: z.literal("simplify"),
    tolerance: z.number().finite().positive(),
    preserve_topology: z.boolean().optional(),
  }),
  z.object({
    action: z.literal("field_calculate"),
    target_field: z.string().min(1),
    operation: z.enum(["add","subtract","multiply","divide"]),
    operands: z.tuple([z.string(), z.string()]),
  }),
  z.object({
    action: z.literal("validate_geometry"),
    mode: z.enum(["check","check_and_fix"]),
  }),
  z.object({
    action: z.literal("buffer"),
    distance: z.number().finite().positive(),
    segments: z.number().int().min(4).optional(),
  }),
  z.object({
    action: z.literal("clip"),
    bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  }),
  z.object({
    action: z.literal("intersect"),
    bbox: z.tuple([z.number().finite(), z.number().finite(), z.number().finite(), z.number().finite()]),
  }),
  z.object({
    action: z.literal("dissolve"),
    field: z.string().min(1),
  }),
  z.object({
    action: z.literal("export"),
    format: z.enum(["geojson","csv"]),
  }),
  z.object({
    action: z.literal("noop"),
    reason: z.string().min(1),
  }),
  z.object({
    action: z.literal("need_clarification"),
    reason: z.string().min(1),
  }),
]);

export const astSchema = z.object({
  version: z.literal('1.0'),
  operations: z.array(operationSchema).min(1),
  target_layer: z.string().optional(),
});
