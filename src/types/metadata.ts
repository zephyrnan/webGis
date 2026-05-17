export type GeoFieldType = 'string' | 'number' | 'boolean' | 'date' | 'geometry' | 'unknown';

export type GeoWarning = {
  code: string;
  message: string;
  recoverable: boolean;
  suggestedUserInput?: string;
};

export type GeoField = {
  name: string;
  type: GeoFieldType;
  sample?: Array<string | number | boolean | null>;
  nullRateEstimate?: number;
};

export type FieldPolicy = {
  totalFieldCount: number;
  includedFieldCount: number;
  truncated: boolean;
};

export type GeoSurgicalMetadata = {
  fileType: 'geojson' | 'shapefile_zip' | 'shapefile' | 'unknown';
  fileName: string;
  fileSize: number;
  featureCountEstimate: number | null;
  fields: GeoField[];
  bbox: [number, number, number, number] | null;
  crs: string | null;
  encoding: string | null;
  fieldPolicy: FieldPolicy;
  warnings: GeoWarning[];
  layers?: LayerInfo[];
};

export type LayerInfo = {
  name: string;
  featureCount: number | null;
  fields: GeoField[];
  bbox: [number, number, number, number] | null;
  encoding: string | null;
};
