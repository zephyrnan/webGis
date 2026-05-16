import { useEffect, useMemo } from 'react';
import { Download } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { SurgeryResult, UndoCapability } from '../types/protocol';
import { UndoStatus } from './UndoStatus';

type ResultPanelProps = {
  result: SurgeryResult | null;
  undo: UndoCapability | null;
};

export function ResultPanel({ result, undo }: ResultPanelProps) {
  const { t } = useI18n();
  const downloadUrl = useMemo(() => {
    if (result?.kind !== 'geojson' || !result.content) return null;
    return URL.createObjectURL(new Blob([JSON.stringify(result.content, null, 2)], { type: 'application/geo+json' }));
  }, [result]);

  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  if (!result) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-500">
        {t('result.empty')}
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{result.fileName}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric label={t('result.inputFeatures')} value={result.summary.inputFeatureCount ?? t('metadata.unknown')} />
        <Metric label={t('result.outputFeatures')} value={result.summary.outputFeatureCount ?? t('metadata.unknown')} />
        <Metric label={t('result.mockMode')} value={result.summary.mockMode ? t('result.yes') : t('result.no')} />
        <Metric label={t('result.operations')} value={result.summary.operations.length} />
      </div>

      <UndoStatus undo={undo} />

      <div className="space-y-2 text-sm text-slate-300">
        {result.logs.map((log) => <p key={log} className="rounded-xl bg-slate-950/70 p-3">{formatResultLog(log, t)}</p>)}
        {result.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-950/30 p-3 text-amber-100">{formatResultWarning(warning, t)}</p>)}
      </div>

      {downloadUrl ? (
        <a
          className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          download={result.fileName}
          href={downloadUrl}
        >
          <Download className="size-4" />
          {t('result.download')}
        </a>
      ) : null}
    </section>
  );
}

function formatResultLog(log: string, t: (key: string, params?: Record<string, string | number>) => string) {
  if (log.startsWith('operation:')) {
    return t('log.operation', { operation: log.slice('operation:'.length) });
  }

  if (log === 'summary:shapefile_mock') {
    return t('log.shapefileMock');
  }

  return log;
}

function formatResultWarning(warning: string, t: (key: string) => string) {
  const key = `warning.${warning}`;
  const value = t(key);
  return value === key ? warning : value;
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-slate-950/70 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}
