import { useI18n } from '../i18n/I18nContext';
import type { GeoSurgicalMetadata } from '../types/metadata';
import { formatBbox, formatBytes } from '../services/formatters';

type MetadataPanelProps = {
  metadata: GeoSurgicalMetadata | null;
};

export function MetadataPanel({ metadata }: MetadataPanelProps) {
  const { t } = useI18n();

  if (!metadata) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-400">
        {t('metadata.empty')}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{metadata.fileName}</h2>
        <p className="text-sm text-slate-400">{metadata.fileType} · {formatBytes(metadata.fileSize)}</p>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric label={t('metadata.featureEstimate')} value={metadata.featureCountEstimate ?? t('metadata.unknown')} />
        <Metric label="CRS" value={metadata.crs ?? t('metadata.notDetected')} />
        <Metric label={t('metadata.encoding')} value={metadata.encoding ?? t('metadata.notDetected')} />
        <Metric label="BBox" value={formatBbox(metadata.bbox)} />
      </div>

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

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-slate-950/70 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 truncate text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}
