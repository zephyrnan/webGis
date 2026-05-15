export const sampleGeojson: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: { id: 'A-001', name: '示例地块 A', area: 12 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [113.94, 22.52],
            [113.98, 22.52],
            [113.98, 22.56],
            [113.94, 22.56],
            [113.94, 22.52],
          ],
        ],
      },
    },
    {
      type: 'Feature',
      properties: { id: 'A-002', name: '', area: 0 },
      geometry: {
        type: 'Polygon',
        coordinates: [
          [
            [114.02, 22.58],
            [114.06, 22.58],
            [114.06, 22.62],
            [114.02, 22.62],
            [114.02, 22.58],
          ],
        ],
      },
    },
  ],
};
