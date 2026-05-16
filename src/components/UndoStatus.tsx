import { useI18n } from '../i18n/I18nContext';
import type { UndoCapability } from '../types/protocol';

type UndoStatusProps = {
  undo: UndoCapability | null;
};

export function UndoStatus({ undo }: UndoStatusProps) {
  const { t } = useI18n();

  if (!undo) return null;

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-300">
      <span className="font-medium text-slate-100">{t('undo.title')}：</span>
      {undo.available ? t('undo.available') : t('undo.unavailable')} · {undo.strategy}
      {undo.reason ? ` · ${undo.reason}` : ''}
    </div>
  );
}
