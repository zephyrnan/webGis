import { useCallback, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, X } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type GeoJSON from 'ol/format/GeoJSON';

const ROW_HEIGHT = 32;
const BUFFER_ROWS = 10;

type SortDir = 'asc' | 'desc';

type AttributeTableProps = {
  geoJson: GeoJSON.FeatureCollection;
  onClose(): void;
};

export function AttributeTable({ geoJson, onClose }: AttributeTableProps) {
  const { t } = useI18n();
  const [sortField, setSortField] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<SortDir>('asc');
  const [filter, setFilter] = useState('');
  const containerRef = useRef<HTMLDivElement>(null);

  const features = geoJson.features ?? [];

  const columns = useMemo(() => {
    const keys = new Set<string>();
    for (const f of features) {
      if (f.properties) {
        for (const key of Object.keys(f.properties)) {
          keys.add(key);
        }
      }
    }
    return [...keys];
  }, [features]);

  const filtered = useMemo(() => {
    if (!filter.trim()) return features;
    const lower = filter.toLowerCase();
    return features.filter((f) => {
      if (!f.properties) return false;
      return Object.values(f.properties).some((v) => v != null && String(v).toLowerCase().includes(lower));
    });
  }, [features, filter]);

  const sorted = useMemo(() => {
    if (!sortField) return filtered;
    return [...filtered].sort((a, b) => {
      const va = a.properties?.[sortField];
      const vb = b.properties?.[sortField];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      const cmp = typeof va === 'number' && typeof vb === 'number'
        ? va - vb
        : String(va).localeCompare(String(vb));
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [filtered, sortField, sortDir]);

  const toggleSort = useCallback((col: string) => {
    if (sortField === col) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(col);
      setSortDir('asc');
    }
  }, [sortField]);

  const totalHeight = sorted.length * ROW_HEIGHT;
  const [scrollTop, setScrollTop] = useState(0);
  const containerHeight = 260;

  const startIdx = Math.max(0, Math.floor(scrollTop / ROW_HEIGHT) - BUFFER_ROWS);
  const endIdx = Math.min(sorted.length, Math.ceil((scrollTop + containerHeight) / ROW_HEIGHT) + BUFFER_ROWS);
  const visibleFeatures = sorted.slice(startIdx, endIdx);
  const paddingTop = startIdx * ROW_HEIGHT;

  const handleScroll = useCallback(() => {
    if (containerRef.current) {
      setScrollTop(containerRef.current.scrollTop);
    }
  }, []);

  return (
    <div className="shrink-0 border-t border-zinc-200">
      <div className="flex items-center justify-between border-b border-zinc-200 px-3 py-2">
        <div className="flex items-center gap-2">
          <h3 className="text-[11px] font-medium text-zinc-600">{t('map.attributeTable')}</h3>
          <span className="text-[10px] text-zinc-400">
            {sorted.length.toLocaleString()} {t('metadata.featureCount')}
          </span>
        </div>
        <div className="flex items-center gap-1.5">
          <input
            className="w-40 rounded-md border border-zinc-300 bg-white px-2 py-1 text-[10px] text-zinc-700 outline-none placeholder:text-zinc-400 focus:border-zinc-400"
            placeholder={t('map.filterTable')}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          />
          <button
            className="rounded p-0.5 text-zinc-400 hover:text-zinc-700"
            type="button"
            onClick={onClose}
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className="overflow-auto bg-white"
        style={{ height: Math.min(containerHeight, totalHeight + ROW_HEIGHT) }}
        onScroll={handleScroll}
      >
        <table className="w-full text-[10px]" style={{ tableLayout: 'fixed' }}>
          <thead className="sticky top-0 z-10 bg-zinc-50">
            <tr>
              {columns.map((col) => (
                <th
                  key={col}
                  className="cursor-pointer select-none border-b border-zinc-200 px-2 py-1.5 text-left font-medium text-zinc-500 hover:text-zinc-700"
                  style={{ minWidth: 70 }}
                  onClick={() => toggleSort(col)}
                >
                  <span className="inline-flex items-center gap-1">
                    {col}
                    {sortField === col && (
                      sortDir === 'asc'
                        ? <ArrowUp className="size-2.5 text-zinc-400" />
                        : <ArrowDown className="size-2.5 text-zinc-400" />
                    )}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr style={{ height: paddingTop }}><td colSpan={columns.length} /></tr>
            {visibleFeatures.map((feature, i) => (
              <tr
                key={startIdx + i}
                className="border-b border-zinc-100 transition hover:bg-zinc-50"
                style={{ height: ROW_HEIGHT }}
              >
                {columns.map((col) => (
                  <td key={col} className="truncate px-2 py-1 text-zinc-600">
                    {feature.properties?.[col] == null ? '' : String(feature.properties[col])}
                  </td>
                ))}
              </tr>
            ))}
            <tr style={{ height: Math.max(0, (sorted.length - endIdx) * ROW_HEIGHT) }}><td colSpan={columns.length} /></tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
