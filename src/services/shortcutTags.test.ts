import { describe, expect, it } from 'vitest';
import { buildShortcutTags } from './shortcutTags';
import type { GeoSurgicalMetadata } from '../types/metadata';

const metadata: GeoSurgicalMetadata = {
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
};

describe('buildShortcutTags', () => {
  it('creates dynamic onboarding tags from metadata in Chinese', () => {
    const tags = buildShortcutTags(metadata, 'zh');

    expect(tags.map((tag) => tag.id)).toContain('transform-gcj02');
    expect(tags.map((tag) => tag.id)).toContain('clean-zero-area');
    expect(tags.map((tag) => tag.id)).toContain('drop-empty-name');
    expect(tags.find((tag) => tag.id === 'drop-empty-name')?.command).toContain('删除 name 字段为空');
  });

  it('creates localized English commands', () => {
    const tags = buildShortcutTags(metadata, 'en');

    expect(tags.find((tag) => tag.id === 'drop-empty-name')?.label).toBe('Remove empty names');
    expect(tags.find((tag) => tag.id === 'drop-empty-name')?.command).toBe('Remove features where name is empty, then export GeoJSON.');
  });
});
