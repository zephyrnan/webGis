import type { ProgressEvent } from '../types/protocol';

type ProgressTimelineProps = {
  items: ProgressEvent[];
};

export function ProgressTimeline({ items }: ProgressTimelineProps) {
  return (
    <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <h2 className="font-semibold text-white">执行心跳</h2>
      <div className="mt-4 space-y-3">
        {items.length === 0 ? (
          <p className="text-sm text-slate-500">暂无进度事件。</p>
        ) : items.map((item, index) => (
          <div key={`${item.phase}-${index}`} className="rounded-2xl bg-slate-950/70 p-3 text-sm">
            <div className="flex items-center justify-between gap-4">
              <span className="font-medium text-slate-100">{item.message}</span>
              <span className="text-xs uppercase text-cyan-300">{item.phase}</span>
            </div>
            {typeof item.percent === 'number' ? (
              <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-slate-800">
                <div className="h-full rounded-full bg-cyan-400" style={{ width: `${item.percent}%` }} />
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}
