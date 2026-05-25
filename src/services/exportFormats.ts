export type ExportFormat = 'geojson' | 'csv';

export function geojsonToCsv(fc: GeoJSON.FeatureCollection): string {
  if (fc.features.length === 0) return '';

  // Collect all property keys
  const keys = new Set<string>();
  for (const f of fc.features) {
    if (f.properties) {
      for (const k of Object.keys(f.properties)) keys.add(k);
    }
  }
  const columns = [...keys];

  // Header
  const header = columns.map(csvEscape).join(',');

  // Rows
  const rows = fc.features.map((f) => {
    const props = f.properties ?? {};
    return columns.map((col) => {
      const val = props[col];
      if (val == null) return '';
      if (typeof val === 'object') return csvEscape(JSON.stringify(val));
      return csvEscape(String(val));
    }).join(',');
  });

  return [header, ...rows].join('\n');
}

function csvEscape(value: string): string {
  if (value.includes(',') || value.includes('"') || value.includes('\n')) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

export function getExportMimeType(format: ExportFormat): string {
  return format === 'csv' ? 'text/csv' : 'application/geo+json';
}

export function getExportExtension(format: ExportFormat): string {
  return format === 'csv' ? '.csv' : '.geojson';
}
