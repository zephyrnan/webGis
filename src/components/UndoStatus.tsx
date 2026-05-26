import { RotateCcw, RotateCw } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { HistoryEntry } from '../types/history';

type UndoStatusProps = {
  history: HistoryEntry[];
  currentIndex: number;
  onUndo(): void;
  onRedo(): void;
  onJumpTo(index: number): void;
};

export function UndoStatus({ history, currentIndex, onUndo, onRedo, onJumpTo }: UndoStatusProps) {
  const { t } = useI18n();

  if (history.length === 0) return null;

  const canUndo = currentIndex > 0;
  const canRedo = currentIndex < history.length - 1;

  const formatTime = (ts: number) => {
    const diff = Math.round((Date.now() - ts) / 1000);
    if (diff < 5) return t('undo.justNow');
    if (diff < 60) return t('undo.secondsAgo', { n: diff });
    if (diff < 3600) return t('undo.minutesAgo', { n: Math.floor(diff / 60) });
    return t('undo.hoursAgo', { n: Math.floor(diff / 3600) });
  };

  const translateOp = (action: string) => t(`operation.${action}`);

  return (
    <div className="rounded-md border border-zinc-200 bg-zinc-100 p-2.5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-[11px] font-medium text-zinc-600">{t('undo.history')}</span>
        <div className="flex gap-0.5">
          <button
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={!canUndo}
            type="button"
            onClick={onUndo}
            title="Ctrl+Z"
          >
            <RotateCcw className="size-3.5" />
          </button>
          <button
            className="rounded p-1 text-zinc-400 transition hover:bg-zinc-200 hover:text-zinc-700 disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={!canRedo}
            type="button"
            onClick={onRedo}
            title="Ctrl+Shift+Z"
          >
            <RotateCw className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="max-h-36 space-y-0.5 overflow-y-auto pr-1">
        {history.map((entry, index) => {
          const isCurrent = index === currentIndex;
          const ops = entry.ast.operations.map((op) => translateOp(op.action)).join(', ');
          const inputCount = entry.resultSnapshot.summary.inputFeatureCount;
          const outputCount = entry.resultSnapshot.summary.outputFeatureCount;

          return (
            <button
              key={entry.id}
              className={`w-full rounded-md px-2 py-1.5 text-left text-[10px] transition ${
                isCurrent
                  ? 'border border-zinc-300 bg-white text-zinc-900'
                  : 'text-zinc-500 hover:bg-zinc-50 hover:text-zinc-700'
              }`}
              type="button"
              onClick={() => onJumpTo(index)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono">{ops}</span>
                <span className="shrink-0 text-zinc-400">{formatTime(entry.timestamp)}</span>
              </div>
              {inputCount != null && outputCount != null && (
                <span className="mt-0.5 text-zinc-400">
                  {t('undo.featureChange', { input: inputCount, output: outputCount })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-1.5 text-center text-[9px] text-zinc-300">{t('undo.keyboardHint')}</p>
    </div>
  );
}
