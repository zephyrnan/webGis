import { FileSearch } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { GeoSurgicalMetadata } from '../types/metadata';
import { formatBbox, formatBytes } from '../services/formatters';

type MetadataPanelProps = {
  metadata: GeoSurgicalMetadata | null;
  selectedLayer?: string | null;
  onSelectLayer?(layerName: string): void;
};

export function MetadataPanel({ metadata, selectedLayer, onSelectLayer }: MetadataPanelProps) {
  const { t } = useI18n();

  if (!metadata) {
    return (
      <section className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
        <FileSearch className="size-5 shrink-0 text-slate-600" />
        {t('metadata.empty')}
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{metadata.fileName}</h2>
        <p className="text-sm text-slate-400">{metadata.fileType} · {formatBytes(metadata.fileSize)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric label={t('metadata.featureEstimate')} value={metadata.featureCountEstimate ?? t('metadata.unknown')} />
        <Metric
          label="CRS"
          value={metadata.crs ?? t('metadata.notDetected')}
          badge={metadata.crsConfidence ? t(`crsConfidence.${metadata.crsConfidence}`) : undefined}
          badgeColor={metadata.crsConfidence === 'authoritative' ? 'emerald' : metadata.crsConfidence === 'heuristic' ? 'amber' : 'slate'}
        />
        <Metric label={t('metadata.encoding')} value={metadata.encoding ?? t('metadata.notDetected')} />
        <Metric label="BBox" value={formatBbox(metadata.bbox, t('metadata.notDetected'))} />
      </div>

      {metadata.layers && metadata.layers.length > 0 && (
        <div>
          <p className="mb-2 text-sm font-medium text-slate-200">{t('metadata.layers')}</p>
          <div className="max-h-40 space-y-1 overflow-auto pr-1">
            {metadata.layers.map((layer) => (
              <button
                key={layer.name}
                className={`w-full rounded-xl px-3 py-2 text-left text-sm transition ${
                  selectedLayer === layer.name
                    ? 'border border-cyan-400/40 bg-cyan-950/40 text-cyan-200'
                    : 'bg-slate-950/70 text-slate-300 hover:bg-slate-800'
                }`}
                type="button"
                onClick={() => onSelectLayer?.(layer.name)}
              >
                <div className="flex items-center justify-between">
                  <span className="font-medium">{layer.name}</span>
                  <span className="text-xs text-slate-500">
                    {layer.featureCount ?? '?'} {t('metadata.featureCount')} · {layer.fields.length} {t('metadata.fields')}
                  </span>
                </div>
                {(layer.crs || layer.encoding) && (
                  <div className="mt-1 flex gap-2 text-xs text-slate-500">
                    {layer.crs && <span>CRS: {layer.crs}</span>}
                    {layer.encoding && <span>{t('metadata.encoding')}: {layer.encoding}</span>}
                  </div>
                )}
              </button>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="mb-2 flex items-center justify-between text-sm">
          <span className="font-medium text-slate-200">{t('metadata.fields')}</span>
          <span className="text-slate-500">
            {metadata.fieldPolicy.includedFieldCount}/{metadata.fieldPolicy.totalFieldCount}
            {metadata.fieldPolicy.truncated ? t('metadata.truncated') : ''}
          </span>
        </div>
        <div className="max-h-48 space-y-2 overflow-auto pr-1">
          {metadata.fields.length === 0 ? (
            <p className="rounded-xl bg-slate-950/70 p-3 text-sm text-slate-500">{t('metadata.noFields')}</p>
          ) : metadata.fields.map((field) => (
            <div key={field.name} className="rounded-xl bg-slate-950/70 p-3 text-sm">
              <div className="flex items-center justify-between gap-3">
                <span className="font-medium text-slate-100">{field.name}</span>
                <span className="text-xs text-cyan-300">{field.type}</span>
              </div>
              {field.sample?.length ? <p className="mt-1 truncate text-slate-500">sample: {field.sample.join(', ')}</p> : null}
            </div>
          ))}
        </div>
      </div>

      {metadata.warnings.length ? (
        <div className="space-y-2">
          {metadata.warnings.map((warning) => (
            <div key={warning.code} className="rounded-xl border border-amber-400/30 bg-amber-950/30 p-3 text-sm text-amber-100">
              <span className="font-semibold">{warning.code}</span>：{t(`warning.${warning.code}`) === `warning.${warning.code}` ? warning.message : t(`warning.${warning.code}`)}
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
  badgeColor?: 'emerald' | 'amber' | 'slate';
}) {
  const colorClass = badgeColor === 'emerald'
    ? 'bg-emerald-950/60 text-emerald-300 border-emerald-400/30'
    : badgeColor === 'amber'
      ? 'bg-amber-950/60 text-amber-300 border-amber-400/30'
      : 'bg-slate-800 text-slate-400 border-slate-600/30';
  return (
    <div className="rounded-2xl bg-slate-950/70 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <div className="mt-1 flex items-center gap-2">
        <p className="truncate text-sm font-medium text-slate-100">{value}</p>
        {badge && (
          <span className={`inline-flex shrink-0 items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium ${colorClass}`}>
            {badge}
          </span>
        )}
      </div>
    </div>
  );
}
