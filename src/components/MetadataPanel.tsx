import { FileSearch } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { GeoLayer } from '../types/layer';
import { formatBbox, formatBytes } from '../services/formatters';
import { LayerTree } from './LayerTree';

type MetadataPanelProps = {
  metadata: GeoSurgicalMetadata | null;
  selectedLayer?: string | null;
  layers: GeoLayer[];
  onSelectLayer?(layerName: string): void;
  onToggleVisibility?(layerName: string): void;
  onToggleExpand?(layerName: string): void;
};

export function MetadataPanel({ metadata, selectedLayer, layers, onSelectLayer, onToggleVisibility, onToggleExpand }: MetadataPanelProps) {
  const { t } = useI18n();

  if (!metadata) {
    return (
      <section className="flex items-center gap-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4 text-xs text-zinc-400">
        <FileSearch className="size-4 shrink-0" />
        {t('metadata.empty')}
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
      <div>
        <h2 className="text-sm font-medium text-zinc-800 truncate">{metadata.fileName}</h2>
        <p className="text-[11px] text-zinc-400 mt-0.5">{metadata.fileType} · {formatBytes(metadata.fileSize)}</p>
      </div>

      <div className="grid grid-cols-2 gap-2 text-[11px]">
        <Metric label={t('metadata.featureEstimate')} value={metadata.featureCountEstimate ?? t('metadata.unknown')} />
        <Metric
          label="CRS"
          value={metadata.crs ?? t('metadata.notDetected')}
          badge={metadata.crsConfidence ? t(`crsConfidence.${metadata.crsConfidence}`) : undefined}
          badgeColor={metadata.crsConfidence === 'authoritative' ? 'emerald' : metadata.crsConfidence === 'heuristic' ? 'amber' : 'zinc'}
        />
        <Metric label={t('metadata.encoding')} value={metadata.encoding ?? t('metadata.notDetected')} />
        <Metric label="BBox" value={formatBbox(metadata.bbox, t('metadata.notDetected'))} />
      </div>

      {layers.length > 0 && (
        <div>
          <p className="mb-1.5 text-[11px] font-medium text-zinc-500 uppercase tracking-wider">{t('metadata.layers')}</p>
          <div className="max-h-48 overflow-y-auto pr-1">
            <LayerTree
              layers={layers}
              selectedLayer={selectedLayer ?? null}
              onSelectLayer={(name) => onSelectLayer?.(name)}
              onToggleVisibility={(name) => onToggleVisibility?.(name)}
              onToggleExpand={(name) => onToggleExpand?.(name)}
            />
          </div>
        </div>
      )}

      <div>
        <div className="mb-1.5 flex items-center justify-between text-[11px]">
          <span className="font-medium text-zinc-500 uppercase tracking-wider">{t('metadata.fields')}</span>
          <span className="text-zinc-400">
            {metadata.fieldPolicy.includedFieldCount}/{metadata.fieldPolicy.totalFieldCount}
            {metadata.fieldPolicy.truncated ? t('metadata.truncated') : ''}
          </span>
        </div>
        <div className="max-h-40 space-y-1 overflow-y-auto pr-1">
          {metadata.fields.length === 0 ? (
            <p className="rounded-md bg-zinc-100 p-2 text-[11px] text-zinc-400">{t('metadata.noFields')}</p>
          ) : metadata.fields.map((field) => (
            <div key={field.name} className="rounded-md bg-zinc-100 px-2.5 py-1.5 text-[11px]">
              <div className="flex items-center justify-between gap-2">
                <span className="font-mono text-zinc-700 truncate">{field.name}</span>
                <span className="shrink-0 text-zinc-400">{field.type}</span>
              </div>
              {field.sample?.length ? <p className="mt-0.5 truncate text-zinc-400">{field.sample.join(', ')}</p> : null}
            </div>
          ))}
        </div>
      </div>

      {metadata.warnings.length ? (
        <div className="space-y-1">
          {metadata.warnings.map((warning) => (
            <div key={warning.code} className="rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-[11px] text-amber-700">
              <span className="font-medium">{warning.code}</span>{' '}
              {t(`warning.${warning.code}`) === `warning.${warning.code}` ? warning.message : t(`warning.${warning.code}`)}
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}

function Metric({ label, value, badge, badgeColor }: {
  label: string;
  value: string | number;
  badge?: string;
  badgeColor?: 'emerald' | 'amber' | 'zinc';
}) {
  const colorClass = badgeColor === 'emerald'
    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
    : badgeColor === 'amber'
      ? 'bg-amber-50 text-amber-700 border-amber-300'
      : 'bg-zinc-100 text-zinc-500 border-zinc-200';
  return (
    <div className="rounded-md bg-zinc-100 px-2.5 py-1.5">
      <p className="text-[10px] text-zinc-400">{label}</p>
      <div className="mt-0.5 flex items-center gap-1.5">
        <p className="truncate text-[11px] font-medium text-zinc-700">{value}</p>
        {badge && (
          <span className={`inline-flex shrink-0 items-center rounded border px-1 py-px text-[9px] font-medium ${colorClass}`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
