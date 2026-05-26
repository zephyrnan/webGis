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

    if (exportFormat === 'csv') {
      const fc = result.content ?? result.previewContent;
      if (!fc) return { url: null, size: 0 };
      const csv = geojsonToCsv(fc);
      const blob = new Blob([csv], { type: 'text/csv' });
      return { url: URL.createObjectURL(blob), size: blob.size };
    }

    if (result.blobUrl) return { url: result.blobUrl, size: 0 };
    if (!result.content) return { url: null, size: 0 };
    const blob = new Blob([JSON.stringify(result.content, null, 2)], { type: 'application/geo+json' });
    return { url: URL.createObjectURL(blob), size: blob.size };
  }, [result, exportFormat]);

  useEffect(() => () => {
    if (url && url !== result?.blobUrl) URL.revokeObjectURL(url);
  }, [url, result?.blobUrl]);

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
      <section className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-400">
        <Inbox className="size-4 shrink-0" />
        {t('result.empty')}
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-start justify-between">
        <h2 className="text-xs font-medium text-zinc-700 truncate">{result.fileName}</h2>
        {size > 0 && (
          <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">{formatSize(size)}</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-1.5 text-[11px]">
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

      <div className="space-y-1 text-[11px] text-zinc-500">
        {result.logs.map((log) => <p key={log} className="rounded-md bg-zinc-100 px-2.5 py-1.5">{formatResultLog(log, t)}</p>)}
        {result.warnings.map((warning) => <p key={warning} className="rounded-md bg-amber-50 px-2.5 py-1.5 text-amber-600">{formatResultWarning(warning, t)}</p>)}
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {url ? (
          <>
            <select
              aria-label="Export format"
              className="rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-[10px] text-zinc-500 outline-none transition hover:border-zinc-400 focus:border-zinc-400"
              value={exportFormat}
              onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
            >
              <option value="geojson">GeoJSON</option>
              <option value="csv">CSV</option>
            </select>
            <a
              className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700"
              download={result.fileName.replace(/\.[^.]+$/, getExportExtension(exportFormat))}
              href={url}
            >
              <Download className="size-3.5" />
              {t('result.download')}
            </a>
          </>
        ) : null}
        {result?.kind !== 'shapefile' && (
          <button
            className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-[11px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700"
            type="button"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
            {copied ? t('result.copied') : (exportFormat === 'csv' ? t('result.copyCsv') : t('result.copyJson'))}
          </button>
        )}
      </div>
    </section>
  );
}

function formatResultLog(log: string, t: (key: string, params?: Record<string, string | number>) => string) {
  if (log.startsWith('operation:')) {
    const body = log.slice('operation:'.length);
    const parts = body.split('|');
    const action = parts[0];
    const translatedOp = t(`operation.${action}`);
    const opName = translatedOp === `operation.${action}` ? action : translatedOp;

    if (parts.length === 1) {
      return t('log.operation', { operation: opName });
    }

    const params: Record<string, string | number> = { operation: opName };
    for (let i = 1; i < parts.length; i++) {
      const eqIndex = parts[i].indexOf('=');
      if (eqIndex !== -1) {
        const key = parts[i].slice(0, eqIndex);
        const rawValue = parts[i].slice(eqIndex + 1);
        params[key] = /^\d+(\.\d+)?$/.test(rawValue) ? Number(rawValue) : rawValue;
      }
    }

    let detailKey = `log.detail.${action}`;
    if (action === 'transform_crs' && params.skipped) {
      detailKey = 'log.detail.transform_crs.skipped';
    } else if (action === 'fix_encoding' && params.reencoded) {
      detailKey = 'log.detail.fix_encoding.reencoded';
    }
    const detailTemplate = t(detailKey, params as Record<string, string>);
    if (detailTemplate !== detailKey) {
      return t('log.operationWithDetail', { operation: opName, detail: detailTemplate });
    }

    return t('log.operation', { operation: opName });
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
    <div className="rounded-md bg-zinc-100 px-2 py-1.5">
      <p className="text-[10px] text-zinc-400">{label}</p>
      <p className="mt-0.5 text-[11px] font-medium text-zinc-700">{value}</p>
    </div>
  );
}

function QualityReportSection({ result, show, onToggle, t }: { result: SurgeryResult; show: boolean; onToggle(): void; t: (key: string, params?: Record<string, string | number>) => string }) {
  const report = buildQualityReport(result);
  const delta = report.featureChange.delta;
  const deltaStr = delta != null ? (delta > 0 ? `+${delta}` : String(delta)) : '—';

  return (
    <div className="space-y-1.5">
      <button
        aria-expanded={show}
        className="flex w-full items-center justify-between text-[10px] text-zinc-400 hover:text-zinc-600 transition"
        type="button"
        onClick={onToggle}
      >
        {t('report.title')}
        <span className="text-[9px]">{show ? '▲' : '▼'}</span>
      </button>

      {show && (
        <div className="space-y-1.5 rounded-md bg-zinc-100 p-2.5 text-[10px]">
          <div className="grid grid-cols-2 gap-1.5">
            <div>
              <p className="text-zinc-400">{t('report.inputFeatures')}</p>
              <p className="font-medium text-zinc-700">{report.featureChange.input ?? '—'}</p>
            </div>
            <div>
              <p className="text-zinc-400">{t('report.outputFeatures')}</p>
              <p className="font-medium text-zinc-700">{report.featureChange.output ?? '—'}</p>
            </div>
            <div>
              <p className="text-zinc-400">{t('report.featureDelta')}</p>
              <p className={`font-medium ${delta != null && delta < 0 ? 'text-amber-600' : 'text-zinc-700'}`}>{deltaStr}</p>
            </div>
            <div>
              <p className="text-zinc-400">{t('report.operations')}</p>
              <p className="font-medium text-zinc-700">{report.operations.length}</p>
            </div>
          </div>

          {report.encodingFixed && (
            <div className="rounded-md bg-emerald-50 p-1.5 text-emerald-700">
              {t('report.encodingFixed')}{report.encodingFrom ? ` (${report.encodingFrom} → UTF-8)` : ''}
            </div>
          )}

          {report.geometryIssues.invalid > 0 && (
            <div className="rounded-md bg-amber-50 p-1.5 text-amber-700">
              {t('report.geometryIssues', { invalid: report.geometryIssues.invalid, fixed: report.geometryIssues.fixed })}
            </div>
          )}

          {report.warnings.length > 0 && (
            <div className="space-y-0.5">
              {report.warnings.map((w) => (
                <p key={w} className="rounded-md bg-amber-50 p-1.5 text-amber-700">{w}</p>
              ))}
            </div>
          )}

          {report.mockMode && (
            <p className="text-zinc-400">{t('report.mockMode')}</p>
          )}
        </div>
      )}
    </div>
  );
}
