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
    fixEncoding: {
      label: '修复编码乱码',
      command: '修复文件中的编码乱码，转为 UTF-8，然后导出 GeoJSON。',
      reason: '检测到编码问题',
    },
    extractMainLayer: {
      label: '提取主图层',
      command: '只提取 "{layerName}" 这个图层，然后导出 GeoJSON。',
      reason: '检测到包含多个图层的压缩包',
    },
    simplifyGeometry: {
      label: '抽稀简化几何',
      command: '数据量太大，帮我做一下几何抽稀，减小文件体积。',
      reason: '要素数量超过 50,000，可能导致渲染卡顿',
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
    fixEncoding: {
      label: 'Fix encoding garbled text',
      command: 'Fix encoding issues in the file, convert to UTF-8, then export GeoJSON.',
      reason: 'Encoding issue detected',
    },
    extractMainLayer: {
      label: 'Extract main layer',
      command: 'Extract only the "{layerName}" layer, then export GeoJSON.',
      reason: 'Multi-layer archive detected',
    },
    simplifyGeometry: {
      label: 'Simplify geometry',
      command: 'The dataset is large. Simplify the geometry to reduce file size.',
      reason: 'Over 50,000 features may cause rendering lag',
    },
  },
  ja: {
    transformGcj02: {
      label: 'GCJ-02 座標に変換',
      command: '座標を EPSG:4326 から GCJ-02 に変換し、GeoJSON をエクスポート。',
      reason: 'WGS84 座標系を検出',
    },
    cleanZeroArea: {
      label: '面積 0 のポリゴンを削除',
      command: 'area が 0 のフィーチャーを削除し、GeoJSON をエクスポート。',
      reason: 'area フィールドを検出',
    },
    dropEmptyName: {
      label: 'name が空のフィーチャーを削除',
      command: 'name フィールドが空のフィーチャーを削除し、GeoJSON をエクスポート。',
      reason: 'name フィールドを検出',
    },
    supplyCrs: {
      label: '元の座標系情報を補完',
      command: 'このファイルの元の座標系は EPSG:4326 です。この座標系で処理を続行してください。',
      reason: '投影情報がありません',
    },
    searchField: {
      label: 'フィールドを検索',
      command: 'フィールドを検索します。完全なフィールド一覧に入力したフィールドが存在するか確認してください。',
      reason: 'フィールドリストが切り捨てられました',
    },
    fixEncoding: {
      label: '文字化けを修正',
      command: 'ファイルの文字化けを修正し、UTF-8 に変換して GeoJSON をエクスポート。',
      reason: 'エンコーディングの問題を検出',
    },
    extractMainLayer: {
      label: 'メインレイヤーを抽出',
      command: '"{layerName}" レイヤーのみを抽出し、GeoJSON をエクスポート。',
      reason: '複数レイヤーを含む圧縮ファイルを検出',
    },
    simplifyGeometry: {
      label: 'ジオメトリを簡略化',
      command: 'データ量が多すぎます。ジオメトリを簡略化してファイルサイズを削減してください。',
      reason: 'フィーチャー数が 50,000 を超え、レンダリングが遅くなる可能性あり',
    },
  },
  ko: {
    transformGcj02: {
      label: 'GCJ-02 좌표로 변환',
      command: '좌표를 EPSG:4326에서 GCJ-02로 변환하고 GeoJSON을 내보내기.',
      reason: 'WGS84 좌표계 감지',
    },
    cleanZeroArea: {
      label: '면적 0 폴리곤 삭제',
      command: 'area가 0인 피처를 삭제하고 GeoJSON을 내보내기.',
      reason: 'area 필드 감지',
    },
    dropEmptyName: {
      label: 'name이 비어 있는 피처 삭제',
      command: 'name 필드가 비어 있는 피처를 삭제하고 GeoJSON을 내보내기.',
      reason: 'name 필드 감지',
    },
    supplyCrs: {
      label: '원본 좌표계 정보 보완',
      command: '이 파일의 원본 좌표계는 EPSG:4326입니다. 이 좌표계로 처리를 계속하세요.',
      reason: '투영 정보 누락',
    },
    searchField: {
      label: '필드 검색',
      command: '필드를 검색합니다. 전체 필드 목록에 입력한 필드가 존재하는지 확인하세요.',
      reason: '필드 목록이 잘렸습니다',
    },
    fixEncoding: {
      label: '인코딩 깨짐 수정',
      command: '파일의 인코딩 문제를 수정하고 UTF-8로 변환하여 GeoJSON을 내보내기.',
      reason: '인코딩 문제 감지',
    },
    extractMainLayer: {
      label: '주 레이어 추출',
      command: '"{layerName}" 레이어만 추출하고 GeoJSON을 내보내기.',
      reason: '여러 레이어가 포함된 압축 파일 감지',
    },
    simplifyGeometry: {
      label: '기하학 단순화',
      command: '데이터량이 너무 많습니다. 기하학을 단순화하여 파일 크기를 줄여주세요.',
      reason: '피처 수가 50,000을 초과하여 렌더링 지연 가능',
    },
  },
  fr: {
    transformGcj02: {
      label: 'Convertir en GCJ-02',
      command: 'Convertir les coordonnées de EPSG:4326 vers GCJ-02, puis exporter en GeoJSON.',
      reason: 'CRS WGS84 détecté',
    },
    cleanZeroArea: {
      label: 'Supprimer les polygones à surface nulle',
      command: 'Supprimer les entités où area est 0, puis exporter en GeoJSON.',
      reason: 'Champ area détecté',
    },
    dropEmptyName: {
      label: 'Supprimer les noms vides',
      command: 'Supprimer les entités où name est vide, puis exporter en GeoJSON.',
      reason: 'Champ name détecté',
    },
    supplyCrs: {
      label: 'Fournir le CRS source',
      command: 'Le CRS source de ce fichier est EPSG:4326. Continuez le traitement avec ce système de coordonnées.',
      reason: 'Métadonnées de projection manquantes',
    },
    searchField: {
      label: 'Rechercher des champs',
      command: 'Rechercher dans la liste complète des champs si le champ que je vais saisir existe.',
      reason: 'Liste des champs tronquée',
    },
    fixEncoding: {
      label: 'Corriger l\'encodage',
      command: 'Corriger les problèmes d\'encodage du fichier, convertir en UTF-8, puis exporter en GeoJSON.',
      reason: 'Problème d\'encodage détecté',
    },
    extractMainLayer: {
      label: 'Extraire la couche principale',
      command: 'Extraire uniquement la couche "{layerName}", puis exporter en GeoJSON.',
      reason: 'Archive multi-couches détectée',
    },
    simplifyGeometry: {
      label: 'Simplifier la géométrie',
      command: 'Le jeu de données est volumineux. Simplifiez la géométrie pour réduire la taille du fichier.',
      reason: 'Plus de 50 000 entités peuvent ralentir l\'affichage',
    },
  },
  es: {
    transformGcj02: {
      label: 'Convertir a GCJ-02',
      command: 'Convertir coordenadas de EPSG:4326 a GCJ-02, luego exportar GeoJSON.',
      reason: 'CRS WGS84 detectado',
    },
    cleanZeroArea: {
      label: 'Eliminar polígonos de área cero',
      command: 'Eliminar entidades donde area es 0, luego exportar GeoJSON.',
      reason: 'Campo area detectado',
    },
    dropEmptyName: {
      label: 'Eliminar nombres vacíos',
      command: 'Eliminar entidades donde name está vacío, luego exportar GeoJSON.',
      reason: 'Campo name detectado',
    },
    supplyCrs: {
      label: 'Proporcionar CRS de origen',
      command: 'El CRS de origen de este archivo es EPSG:4326. Continúe el procesamiento con este sistema de coordenadas.',
      reason: 'Faltan metadatos de proyección',
    },
    searchField: {
      label: 'Buscar campos',
      command: 'Buscar en la lista completa de campos si el campo que voy a ingresar existe.',
      reason: 'Lista de campos truncada',
    },
    fixEncoding: {
      label: 'Corregir codificación',
      command: 'Corregir problemas de codificación del archivo, convertir a UTF-8, luego exportar GeoJSON.',
      reason: 'Problema de codificación detectado',
    },
    extractMainLayer: {
      label: 'Extraer capa principal',
      command: 'Extraer solo la capa "{layerName}", luego exportar GeoJSON.',
      reason: 'Archivo comprimido con múltiples capas detectado',
    },
    simplifyGeometry: {
      label: 'Simplificar geometría',
      command: 'El conjunto de datos es grande. Simplifique la geometría para reducir el tamaño del archivo.',
      reason: 'Más de 50,000 entidades pueden ralentizar el renderizado',
    },
  },
} satisfies Record<Language, Record<string, Omit<ShortcutTag, 'id'>>>;

export function buildShortcutTags(metadata: GeoSurgicalMetadata, language: Language = 'zh'): ShortcutTag[] {
  const tags: ShortcutTag[] = [];
  const fieldNames = new Set(metadata.fields.map((field) => field.name.toLowerCase()));
  const text = copy[language];

  if (metadata.layers && metadata.layers.length > 1) {
    const mainLayer = [...metadata.layers].sort((a, b) => (b.featureCount ?? 0) - (a.featureCount ?? 0))[0];
    if (mainLayer) {
      tags.push({
        id: 'extract-main-layer',
        label: text.extractMainLayer.label,
        command: text.extractMainLayer.command.replace('{layerName}', mainLayer.name),
        reason: text.extractMainLayer.reason,
      });
    }
  }

  if (metadata.featureCountEstimate && metadata.featureCountEstimate > 50000) {
    tags.push({ id: 'simplify-geometry', ...text.simplifyGeometry });
  }

  if (metadata.crs === 'EPSG:4326') {
    tags.push({ id: 'transform-gcj02', ...text.transformGcj02 });
  }

  if (fieldNames.has('area')) {
    tags.push({ id: 'clean-zero-area', ...text.cleanZeroArea });
  }

  if (fieldNames.has('name')) {
    tags.push({ id: 'drop-empty-name', ...text.dropEmptyName });
  }

  if (metadata.warnings.some((warning) => warning.code === 'MISSING_PRJ' || warning.code === 'CRS_UNKNOWN' || warning.code === 'CRS_UNRECOGNIZED')) {
    tags.push({ id: 'supply-crs', ...text.supplyCrs });
  }

  if (metadata.fieldPolicy.truncated) {
    tags.push({ id: 'search-field', ...text.searchField });
  }

  if (metadata.warnings.some((warning) => warning.code === 'MISSING_CPG' || warning.code === 'ENCODING_MISMATCH' || warning.code === 'LOSSY_UTF8')
    || (metadata.encoding && metadata.encoding !== 'UTF-8' && metadata.encoding !== 'utf-8')) {
    tags.push({ id: 'fix-encoding', ...text.fixEncoding });
  }

  return tags.slice(0, 4);
}
