import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Inbox } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { HistoryEntry } from '../types/history';
import type { SurgeryResult } from '../types/protocol';
import type { ExportFormat } from '../services/exportFormats';
import { geojsonToCsv, getExportExtension } from '../services/exportFormats';
import { buildQualityReport } from '../services/qualityReport';
import { UndoStatus } from './UndoStatus';

type ResultPanelProps = {
  result: SurgeryResult | null;
  history: HistoryEntry[];
  historyIndex: number;
  onUndo(): void;
  onRedo(): void;
  onJumpTo(index: number): void;
  onExportComplete?(): void;
};

export function ResultPanel({ result, history, historyIndex, onUndo, onRedo, onJumpTo, onExportComplete }: ResultPanelProps) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('geojson');
  const [showReport, setShowReport] = useState(false);

  const { url, size } = useMemo(() => {
    if (result?.kind !== 'geojson' && result?.kind !== 'shapefile') return { url: null, size: 0 };

    // CSV export: always need the GeoJSON content object
    if (exportFormat === 'csv') {
      const fc = result.content ?? result.previewContent;
      if (!fc) return { url: null, size: 0 };
      const csv = geojsonToCsv(fc);
      const blob = new Blob([csv], { type: 'text/csv' });
      return { url: URL.createObjectURL(blob), size: blob.size };
    }

    // GeoJSON: Real WASM blob URL or mock content
    if (result.blobUrl) return { url: result.blobUrl, size: 0 };
    if (!result.content) return { url: null, size: 0 };
    const blob = new Blob([JSON.stringify(result.content, null, 2)], { type: 'application/geo+json' });
    return { url: URL.createObjectURL(blob), size: blob.size };
  }, [result, exportFormat]);

  // Revoke object URL on unmount or change (only revoke locally-created URLs)
  useEffect(() => () => {
    if (url && url !== result?.blobUrl) URL.revokeObjectURL(url);
  }, [url, result?.blobUrl]);

  // Notify parent when export URL is created (for cleanup coordination)
  useEffect(() => {
    if (url && onExportComplete) {
      return () => onExportComplete();
    }
  }, [url, onExportComplete]);

  const handleCopy = async () => {
    if (!result) return;
    try {
      let text: string;
      if (exportFormat === 'csv') {
        const fc = result.content ?? result.previewContent;
        if (!fc) return;
        text = geojsonToCsv(fc);
      } else if (result.blobUrl) {
        const resp = await fetch(result.blobUrl);
        text = await resp.text();
      } else if (result.content) {
        text = JSON.stringify(result.content, null, 2);
      } else {
        return;
      }
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard API may fail in some contexts
    }
  };

  const formatSize = (bytes: number) => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  if (!result) {
    return (
      <section className="flex items-center gap-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-500">
        <Inbox className="size-5 shrink-0 text-slate-600" />
        {t('result.empty')}
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-start justify-between">
        <h2 className="text-lg font-semibold text-white">{result.fileName}</h2>
        {size > 0 && (
          <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs text-slate-400">{formatSize(size)}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric label={t('result.inputFeatures')} value={result.summary.inputFeatureCount ?? t('metadata.unknown')} />
        <Metric label={t('result.outputFeatures')} value={result.summary.outputFeatureCount ?? t('metadata.unknown')} />
        <Metric label={t('result.mockMode')} value={result.summary.mockMode ? t('result.yes') : t('result.no')} />
        <Metric label={t('result.operations')} value={result.summary.operations.length} />
      </div>

      <UndoStatus
        history={history}
        currentIndex={historyIndex}
        onUndo={onUndo}
        onRedo={onRedo}
        onJumpTo={onJumpTo}
      />

      <QualityReportSection result={result} show={showReport} onToggle={() => setShowReport((v) => !v)} t={t} />

      <div className="space-y-2 text-sm text-slate-300">
        {result.logs.map((log) => <p key={log} className="rounded-xl bg-slate-950/70 p-3">{formatResultLog(log, t)}</p>)}
        {result.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-950/30 p-3 text-amber-100">{formatResultWarning(warning, t)}</p>)}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {url ? (
          <>
            <select
              className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-2 text-xs text-slate-300 outline-none transition hover:border-cyan-400 focus:border-cyan-400"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            >
              <option value="geojson">GeoJSON</option>
              <option value="csv">CSV</option>
            </select>
            <a
              className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
              download={result.fileName.replace(/\.[^.]+$/, getExportExtension(exportFormat))}
              href={url}
            >
              <Download className="size-4" />
              {t('result.download')}
            </a>
          </>
        ) : null}
        {result?.kind !== 'shapefile' && (
          <button
            className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-white"
            type="button"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            {copied ? t('result.copied') : (exportFormat === 'csv' ? t('result.copyCsv') : t('result.copyJson'))}
          </button>
        )}
      </div>
    </section>
  );
}

function formatResultLog(log: string, t: (key: string, params?: Record<string, string | number>) => string) {
  if (log.startsWith('operation:')) {
    const rawOp = log.slice('operation:'.length);
    const translatedOp = t(`operation.${rawOp}`);
    return t('log.operation', { operation: translatedOp === `operation.${rawOp}` ? rawOp : translatedOp });
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

function QualityReportSection({ result, show, onToggle, t }: { result: SurgeryResult; show: boolean; onToggle(): void; t: (key: string, params?: Record<string, string | number>) => string }) {
  const report = buildQualityReport(result);
  const delta = report.featureChange.delta;
  const deltaStr = delta != null ? (delta > 0 ? `+${delta}` : String(delta)) : '—';

  return (
    <div className="space-y-2">
      <button
        className="flex w-full items-center justify-between text-xs text-slate-500 hover:text-slate-300"
        type="button"
        onClick={onToggle}
      >
        {t('report.title')}
        <span className="text-[10px]">{show ? '▲' : '▼'}</span>
      </button>

      {show && (
        <div className="space-y-2 rounded-2xl bg-slate-950/70 p-3 text-xs">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <p className="text-slate-500">{t('report.inputFeatures')}</p>
              <p className="font-medium text-slate-200">{report.featureChange.input ?? '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">{t('report.outputFeatures')}</p>
              <p className="font-medium text-slate-200">{report.featureChange.output ?? '—'}</p>
            </div>
            <div>
              <p className="text-slate-500">{t('report.featureDelta')}</p>
              <p className={`font-medium ${delta != null && delta < 0 ? 'text-amber-300' : 'text-slate-200'}`}>{deltaStr}</p>
            </div>
            <div>
              <p className="text-slate-500">{t('report.operations')}</p>
              <p className="font-medium text-slate-200">{report.operations.length}</p>
            </div>
          </div>

          {report.encodingFixed && (
            <div className="rounded-xl bg-emerald-950/30 p-2 text-emerald-300">
              {t('report.encodingFixed')}{report.encodingFrom ? ` (${report.encodingFrom} → UTF-8)` : ''}
            </div>
          )}

          {report.geometryIssues.invalid > 0 && (
            <div className="rounded-xl bg-amber-950/30 p-2 text-amber-300">
              {t('report.geometryIssues', { invalid: report.geometryIssues.invalid, fixed: report.geometryIssues.fixed })}
            </div>
          )}

          {report.warnings.length > 0 && (
            <div className="space-y-1">
              {report.warnings.map((w) => (
                <p key={w} className="rounded-xl bg-amber-950/20 p-2 text-amber-200">{w}</p>
              ))}
            </div>
          )}

          {report.mockMode && (
            <p className="text-slate-600">{t('report.mockMode')}</p>
          )}
        </div>
      )}
    </div>
  );
}
