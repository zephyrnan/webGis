import { Activity } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { ProgressEvent } from '../types/protocol';

type ProgressTimelineProps = {
  items: ProgressEvent[];
};

export function ProgressTimeline({ items }: ProgressTimelineProps) {
  const { t } = useI18n();

  return (
    <section className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <h2 className="text-xs font-medium text-zinc-600">{t('progress.title')}</h2>
      <div className="mt-2 space-y-1.5">
        {items.length === 0 ? (
          <div className="flex items-center gap-2 text-[11px] text-zinc-400">
            <Activity className="size-3.5 shrink-0" />
            {t('progress.empty')}
          </div>
        ) : items.map((item, index) => (
          <div key={`${item.phase}-${index}`} className="animate-fade-in rounded-md bg-zinc-100 px-2.5 py-1.5 text-[11px]">
            <div className="flex items-center justify-between gap-3">
              <span className="text-zinc-700 truncate">{item.messageKey ? t(item.messageKey, item.params) : item.message}</span>
              <span className="shrink-0 text-[10px] uppercase text-zinc-400">{item.phase}</span>
            </div>
            {typeof item.percent === 'number' ? (
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-zinc-200">
                <div className="h-full rounded-full bg-zinc-900 transition-all duration-500" style={{ width: `${item.percent}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
