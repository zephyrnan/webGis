import { useEffect, useMemo, useState } from 'react';
import { Check, Copy, Download, Inbox } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { HistoryEntry } from '../types/history';
import type { SurgeryResult } from '../types/protocol';
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

  const { url, size } = useMemo(() => {
    if (result?.kind !== 'geojson' && result?.kind !== 'shapefile') return { url: null, size: 0 };
    // Real WASM: Worker 已创建 Blob URL，直接使用，不重新序列化
    if (result.blobUrl) return { url: result.blobUrl, size: 0 };
    // Mock 模式: content 是 JS 对象，需要序列化创建 Blob
    if (!result.content) return { url: null, size: 0 };
    const blob = new Blob([JSON.stringify(result.content, null, 2)], { type: 'application/geo+json' });
    return { url: URL.createObjectURL(blob), size: blob.size };
  }, [result]);

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
      if (result.blobUrl) {
        // Real WASM: 从 Blob URL fetch 内容
        const resp = await fetch(result.blobUrl);
        text = await resp.text();
      } else if (result.content) {
        // Mock 模式: 序列化 content 对象
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

      <div className="space-y-2 text-sm text-slate-300">
        {result.logs.map((log) => <p key={log} className="rounded-xl bg-slate-950/70 p-3">{formatResultLog(log, t)}</p>)}
        {result.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-950/30 p-3 text-amber-100">{formatResultWarning(warning, t)}</p>)}
      </div>

      <div className="flex flex-wrap gap-2">
        {url ? (
          <a
            className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
            download={result.fileName}
            href={url}
          >
            <Download className="size-4" />
            {t('result.download')}
          </a>
        ) : null}
        {result?.kind !== 'shapefile' && (
          <button
            className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm text-slate-300 transition hover:border-cyan-400 hover:text-white"
            type="button"
            onClick={handleCopy}
          >
            {copied ? <Check className="size-4 text-green-400" /> : <Copy className="size-4" />}
            {copied ? t('result.copied') : t('result.copyJson')}
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
