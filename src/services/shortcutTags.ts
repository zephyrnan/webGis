import type { Language } from '../i18n/locales';
import type { GeoSurgicalMetadata } from '../types/metadata';

export type ShortcutTag = {
  id: string;
  label: string;
  command: string;
  reason: string;
};

const copy = {
  zh: {
    transformGcj02: {
      label: '一键纠偏至火星坐标',
      command: '把坐标从 EPSG:4326 转成火星坐标，然后导出 GeoJSON。',
      reason: '检测到 WGS84 坐标系',
    },
    cleanZeroArea: {
      label: '清理 area 为 0 的废弃多边形',
      command: '删除 area 为 0 的要素，然后导出 GeoJSON。',
      reason: '检测到 area 字段',
    },
    dropEmptyName: {
      label: '删除 name 为空的要素',
      command: '删除 name 字段为空的要素，然后导出 GeoJSON。',
      reason: '检测到 name 字段',
    },
    supplyCrs: {
      label: '补充原始坐标系信息',
      command: '这个文件的原始坐标系是 EPSG:4326，请按这个坐标系继续处理。',
      reason: '检测到投影信息缺失',
    },
    searchField: {
      label: '搜索我提到的字段',
      command: '我想搜索字段，请帮我检查完整字段目录里是否存在我接下来输入的字段。',
      reason: '字段列表已截断',
    },
  },
  en: {
    transformGcj02: {
      label: 'Convert to GCJ-02',
      command: 'Convert coordinates from EPSG:4326 to GCJ-02, then export GeoJSON.',
      reason: 'WGS84 CRS detected',
    },
    cleanZeroArea: {
      label: 'Remove zero-area features',
      command: 'Remove features where area is 0, then export GeoJSON.',
      reason: 'area field detected',
    },
    dropEmptyName: {
      label: 'Remove empty names',
      command: 'Remove features where name is empty, then export GeoJSON.',
      reason: 'name field detected',
    },
    supplyCrs: {
      label: 'Provide source CRS',
      command: 'The source CRS is EPSG:4326. Continue processing with this coordinate system.',
      reason: 'Projection metadata is missing',
    },
    searchField: {
      label: 'Search field names',
      command: 'Search the full field list for the field I type next.',
      reason: 'Field list was truncated',
    },
  },
} satisfies Record<Language, Record<string, Omit<ShortcutTag, 'id'>>>;

export function buildShortcutTags(metadata: GeoSurgicalMetadata, language: Language = 'zh'): ShortcutTag[] {
  const tags: ShortcutTag[] = [];
  const fieldNames = new Set(metadata.fields.map((field) => field.name.toLowerCase()));
  const text = copy[language];

  if (metadata.crs === 'EPSG:4326') {
    tags.push({ id: 'transform-gcj02', ...text.transformGcj02 });
  }

  if (fieldNames.has('area')) {
    tags.push({ id: 'clean-zero-area', ...text.cleanZeroArea });
  }

  if (fieldNames.has('name')) {
    tags.push({ id: 'drop-empty-name', ...text.dropEmptyName });
  }

  if (metadata.warnings.some((warning) => warning.code === 'MISSING_PRJ' || warning.code === 'CRS_UNKNOWN')) {
    tags.push({ id: 'supply-crs', ...text.supplyCrs });
  }

  if (metadata.fieldPolicy.truncated) {
    tags.push({ id: 'search-field', ...text.searchField });
  }

  return tags.slice(0, 4);
}
