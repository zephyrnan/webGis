import { useCallback, useEffect, useState } from 'react';
import { Clock, RotateCcw, Trash2 } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { loadSessions, deleteSession, clearSessions } from '../services/history';
import type { PersistedSession } from '../services/history';

type HistoryPanelProps = {
  onLoadSession(session: PersistedSession): void;
};

export function HistoryPanel({ onLoadSession }: HistoryPanelProps) {
  const { t } = useI18n();
  const [sessions, setSessions] = useState<PersistedSession[]>([]);
  const [loading, setLoading] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await loadSessions(30);
      setSessions(items);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    await deleteSession(id);
    setSessions((prev) => prev.filter((s) => s.id !== id));
  };

  const handleClear = async () => {
    await clearSessions();
    setSessions([]);
  };

  const formatTime = (ts: number) => {
    const d = new Date(ts);
    const now = Date.now();
    const diff = now - ts;
    if (diff < 60_000) return t('undo.justNow');
    if (diff < 3_600_000) return t('undo.minutesAgo', { n: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t('undo.hoursAgo', { n: Math.floor(diff / 3_600_000) });
    return d.toLocaleDateString();
  };

  const operationsSummary = (session: PersistedSession) => {
    const ops = session.ast.operations
      .filter((op) => op.action !== 'export')
      .map((op) => t(`operation.${op.action}`));
    return ops.length > 0 ? ops.join(' → ') : t('operation.export');
  };

  if (sessions.length === 0 && !loading) return null;

  return (
    <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-lg font-semibold text-white">
          <Clock className="size-4 text-slate-400" />
          {t('history.title')}
        </h2>
        {sessions.length > 0 && (
          <button
            className="text-xs text-slate-500 hover:text-red-400"
            type="button"
            onClick={handleClear}
          >
            {t('history.clearAll')}
          </button>
        )}
      </div>

      {loading && <p className="text-sm text-slate-500">{t('history.loading')}</p>}

      <ul className="space-y-2 max-h-80 overflow-auto">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="group flex items-start gap-3 rounded-2xl bg-slate-950/70 p-3 transition hover:bg-slate-800/50"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-slate-200">{session.fileName}</p>
              {session.command && (
                <p className="mt-0.5 truncate text-xs text-slate-500">{session.command}</p>
              )}
              <p className="mt-1 text-[11px] text-slate-600">{operationsSummary(session)}</p>
              <p className="mt-0.5 text-[10px] text-slate-700">{formatTime(session.timestamp)}</p>
            </div>
            <div className="flex shrink-0 gap-1 opacity-0 transition group-hover:opacity-100">
              <button
                className="rounded-lg p-1.5 text-slate-400 hover:bg-cyan-950/50 hover:text-cyan-300"
                type="button"
                title={t('history.restore')}
                onClick={() => onLoadSession(session)}
              >
                <RotateCcw className="size-3.5" />
              </button>
              <button
                className="rounded-lg p-1.5 text-slate-400 hover:bg-red-950/50 hover:text-red-400"
                type="button"
                title={t('history.delete')}
                onClick={() => void handleDelete(session.id)}
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
