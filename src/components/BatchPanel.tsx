import { CheckCircle, Loader2, XCircle, Clock, Trash2, StopCircle } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { BatchItem, BatchState } from '../hooks/useBatchProcessor';

type BatchPanelProps = {
  batch: BatchState;
  onCancel(): void;
  onClear(): void;
  onItemClick(item: BatchItem): void;
};

export function BatchPanel({ batch, onCancel, onClear, onItemClick }: BatchPanelProps) {
  const { t } = useI18n();

  if (batch.items.length === 0) return null;

  const doneCount = batch.items.filter((i) => i.status === 'done').length;
  const errorCount = batch.items.filter((i) => i.status === 'error').length;

  return (
    <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-white">
          {t('batch.title')}
          <span className="ml-2 text-xs text-slate-400">
            {doneCount}/{batch.items.length}
            {errorCount > 0 && <span className="ml-1 text-red-400">({errorCount} {t('batch.failed')})</span>}
          </span>
        </h3>
        <div className="flex gap-2">
          {batch.running && (
            <button
              className="inline-flex items-center gap-1.5 rounded-full border border-red-500/40 bg-red-950/30 px-3 py-1.5 text-xs text-red-300 transition hover:border-red-400 hover:text-red-200"
              type="button"
              onClick={onCancel}
            >
              <StopCircle className="size-3.5" />
              {t('batch.cancel')}
            </button>
          )}
          {!batch.running && (
            <button
              className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-3 py-1.5 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-300"
              type="button"
              onClick={onClear}
            >
              <Trash2 className="size-3.5" />
              {t('batch.clear')}
            </button>
          )}
        </div>
      </div>

      {batch.running && (
        <div className="h-1.5 overflow-hidden rounded-full bg-slate-800">
          <div
            className="h-full rounded-full bg-cyan-400 transition-all duration-300"
            style={{ width: `${(doneCount / batch.items.length) * 100}%` }}
          />
        </div>
      )}

      <ul className="max-h-60 space-y-1.5 overflow-y-auto pr-1">
        {batch.items.map((item) => (
          <li key={item.id}>
            <button
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-xs transition hover:bg-slate-800/50 disabled:cursor-default disabled:opacity-50"
              type="button"
              disabled={item.status !== 'done'}
              onClick={() => onItemClick(item)}
            >
              <ItemStatusIcon status={item.status} />
              <span className={`flex-1 truncate ${item.status === 'error' ? 'text-red-300' : 'text-slate-300'}`}>
                {item.fileName}
              </span>
              {item.error && (
                <span className="max-w-[140px] truncate text-[10px] text-red-400" title={item.error}>
                  {item.error}
                </span>
              )}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ItemStatusIcon({ status }: { status: BatchItem['status'] }) {
  switch (status) {
    case 'pending':
      return <Clock className="size-3.5 shrink-0 text-slate-600" />;
    case 'processing':
      return <Loader2 className="size-3.5 shrink-0 animate-spin text-cyan-400" />;
    case 'done':
      return <CheckCircle className="size-3.5 shrink-0 text-emerald-400" />;
    case 'error':
      return <XCircle className="size-3.5 shrink-0 text-red-400" />;
  }
}
