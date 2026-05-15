import { describe, expect, it } from 'vitest';
import { buildShortcutTags } from './shortcutTags';
import type { GeoSurgicalMetadata } from '../types/metadata';

describe('buildShortcutTags', () => {
  it('creates dynamic onboarding tags from metadata', () => {
    const tags = buildShortcutTags({
      fileType: 'geojson',
      fileName: 'test.geojson',
      fileSize: 100,
      featureCountEstimate: 1,
      fields: [{ name: 'area', type: 'number' }, { name: 'name', type: 'string' }],
      bbox: null,
      crs: 'EPSG:4326',
      encoding: 'UTF-8',
      fieldPolicy: { totalFieldCount: 2, includedFieldCount: 2, truncated: false },
      warnings: [],
    });

    expect(tags.map((tag) => tag.id)).toContain('transform-gcj02');
    expect(tags.map((tag) => tag.id)).toContain('clean-zero-area');
    expect(tags.map((tag) => tag.id)).toContain('drop-empty-name');
  });
});
