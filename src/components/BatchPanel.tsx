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
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[11px] font-medium text-zinc-600">
          {t('batch.title')}
          <span className="ml-1.5 text-[10px] text-zinc-400">
            {doneCount}/{batch.items.length}
            {errorCount > 0 && <span className="ml-1 text-red-500">({errorCount} {t('batch.failed')})</span>}
          </span>
        </h3>
        <div className="flex gap-1">
          {batch.running && (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-red-300 bg-red-50 px-2 py-1 text-[10px] text-red-600 transition hover:border-red-400 hover:text-red-700"
              type="button"
              onClick={onCancel}
            >
              <StopCircle className="size-3" />
              {t('batch.cancel')}
            </button>
          )}
          {!batch.running && (
            <button
              className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-1 text-[10px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700"
              type="button"
              onClick={onClear}
            >
              <Trash2 className="size-3" />
              {t('batch.clear')}
            </button>
          )}
        </div>
      </div>

      {batch.running && (
        <div className="h-1 overflow-hidden rounded-full bg-zinc-200">
          <div
            className="h-full rounded-full bg-zinc-900 transition-all duration-300"
            style={{ width: `${(doneCount / batch.items.length) * 100}%` }}
          />
        </div>
      )}

      <ul className="max-h-40 space-y-0.5 overflow-y-auto pr-1">
        {batch.items.map((item) => (
          <li key={item.id}>
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[11px] transition hover:bg-zinc-100 disabled:cursor-default disabled:opacity-50"
              type="button"
              disabled={item.status !== 'done'}
              onClick={() => onItemClick(item)}
            >
              <ItemStatusIcon status={item.status} />
              <span className={`flex-1 truncate ${item.status === 'error' ? 'text-red-500' : 'text-zinc-500'}`}>
                {item.fileName}
              </span>
              {item.error && (
                <span className="max-w-[120px] truncate text-[9px] text-red-500" title={item.error}>
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
      return <Clock className="size-3 shrink-0 text-zinc-400" />;
    case 'processing':
      return <Loader2 className="size-3 shrink-0 animate-spin text-zinc-500" />;
    case 'done':
      return <CheckCircle className="size-3 shrink-0 text-emerald-500" />;
    case 'error':
      return <XCircle className="size-3 shrink-0 text-red-500" />;
  }
}
