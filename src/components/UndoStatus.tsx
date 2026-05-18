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
    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-4">
      <div className="mb-3 flex items-center justify-between">
        <span className="text-sm font-medium text-slate-100">{t('undo.history')}</span>
        <div className="flex gap-1">
          <button
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={!canUndo}
            type="button"
            onClick={onUndo}
            title="Ctrl+Z"
          >
            <RotateCcw className="size-4" />
          </button>
          <button
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-800 hover:text-white disabled:opacity-30 disabled:hover:bg-transparent"
            disabled={!canRedo}
            type="button"
            onClick={onRedo}
            title="Ctrl+Shift+Z"
          >
            <RotateCw className="size-4" />
          </button>
        </div>
      </div>

      <div className="max-h-48 space-y-1 overflow-auto pr-1">
        {history.map((entry, index) => {
          const isCurrent = index === currentIndex;
          const ops = entry.ast.operations.map((op) => translateOp(op.action)).join(', ');
          const inputCount = entry.resultSnapshot.summary.inputFeatureCount;
          const outputCount = entry.resultSnapshot.summary.outputFeatureCount;

          return (
            <button
              key={entry.id}
              className={`w-full rounded-xl px-3 py-2 text-left text-xs transition ${
                isCurrent
                  ? 'border border-cyan-400/40 bg-cyan-950/40 text-cyan-200'
                  : 'bg-slate-900/50 text-slate-400 hover:bg-slate-800 hover:text-slate-200'
              }`}
              type="button"
              onClick={() => onJumpTo(index)}
            >
              <div className="flex items-center justify-between gap-2">
                <span className="truncate font-mono">{ops}</span>
                <span className="shrink-0 text-slate-600">{formatTime(entry.timestamp)}</span>
              </div>
              {inputCount != null && outputCount != null && (
                <span className="mt-0.5 text-slate-500">
                  {t('undo.featureChange', { input: inputCount, output: outputCount })}
                </span>
              )}
            </button>
          );
        })}
      </div>

      <p className="mt-2 text-center text-[10px] text-slate-600">{t('undo.keyboardHint')}</p>
    </div>
  );
}
