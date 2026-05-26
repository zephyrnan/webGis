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
    } catch {
      setSessions([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  const handleDelete = async (id: string) => {
    try {
      await deleteSession(id);
      setSessions((prev) => prev.filter((s) => s.id !== id));
    } catch {
      // Silently ignore — user can retry
    }
  };

  const handleClear = async () => {
    try {
      await clearSessions();
      setSessions([]);
    } catch {
      // Silently ignore — user can retry
    }
  };

  const formatTime = (ts: number) => {
    const diff = Date.now() - ts;
    if (diff < 60_000) return t('undo.justNow');
    if (diff < 3_600_000) return t('undo.minutesAgo', { n: Math.floor(diff / 60_000) });
    if (diff < 86_400_000) return t('undo.hoursAgo', { n: Math.floor(diff / 3_600_000) });
    return new Date(ts).toLocaleDateString();
  };

  const operationsSummary = (session: PersistedSession) => {
    const ops = session.ast.operations
      .filter((op) => op.action !== 'export')
      .map((op) => t(`operation.${op.action}`));
    return ops.length > 0 ? ops.join(' → ') : t('operation.export');
  };

  if (sessions.length === 0 && !loading) return null;

  return (
    <section className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-xs font-medium text-zinc-600">
          <Clock className="size-3.5 text-zinc-400" />
          {t('history.title')}
        </h2>
        {sessions.length > 0 && (
          <button
            className="text-[10px] text-zinc-400 hover:text-red-500 transition"
            type="button"
            onClick={handleClear}
          >
            {t('history.clearAll')}
          </button>
        )}
      </div>

      {loading && <p className="text-[11px] text-zinc-400">{t('history.loading')}</p>}

      <ul className="space-y-1 max-h-60 overflow-y-auto pr-1">
        {sessions.map((session) => (
          <li
            key={session.id}
            className="group flex items-start gap-2 rounded-md bg-zinc-100 px-2.5 py-2 transition hover:bg-zinc-200"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[11px] font-medium text-zinc-700">{session.fileName}</p>
              {session.command && (
                <p className="mt-0.5 truncate text-[10px] text-zinc-400 font-mono">{session.command}</p>
              )}
              <p className="mt-0.5 text-[10px] text-zinc-400">{operationsSummary(session)}</p>
              <p className="text-[9px] text-zinc-300">{formatTime(session.timestamp)}</p>
            </div>
            <div className="flex shrink-0 gap-0.5 opacity-0 transition group-hover:opacity-100">
              <button
                className="rounded p-1 text-zinc-400 hover:bg-zinc-200 hover:text-zinc-700"
                type="button"
                title={t('history.restore')}
                onClick={() => onLoadSession(session)}
              >
                <RotateCcw className="size-3" />
              </button>
              <button
                className="rounded p-1 text-zinc-400 hover:bg-red-50 hover:text-red-500"
                type="button"
                title={t('history.delete')}
                onClick={() => void handleDelete(session.id)}
              >
                <Trash2 className="size-3" />
              </button>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
