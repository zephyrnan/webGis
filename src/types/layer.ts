export type GeoLayerField = {
  field: string;
  type: string;
  sample: unknown;
};

export type GeoLayer = {
  id: string;
  name: string;
  featureCount: number | null;
  crs: string | null;
  encoding: string | null;
  isVisible: boolean;
  schema: GeoLayerField[];
  isExpanded?: boolean;
};
