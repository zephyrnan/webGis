import { useEffect, useMemo } from 'react';
import { Download } from 'lucide-react';
import type { SurgeryResult, UndoCapability } from '../types/protocol';
import { UndoStatus } from './UndoStatus';

type ResultPanelProps = {
  result: SurgeryResult | null;
  undo: UndoCapability | null;
};

export function ResultPanel({ result, undo }: ResultPanelProps) {
  const downloadUrl = useMemo(() => {
    if (result?.kind !== 'geojson' || !result.content) return null;
    return URL.createObjectURL(new Blob([JSON.stringify(result.content, null, 2)], { type: 'application/geo+json' }));
  }, [result]);

  useEffect(() => () => {
    if (downloadUrl) URL.revokeObjectURL(downloadUrl);
  }, [downloadUrl]);

  if (!result) {
    return (
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-500">
        执行完成后会显示结果摘要和下载入口。
      </section>
    );
  }

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Result</p>
        <h2 className="mt-1 text-lg font-semibold text-white">{result.fileName}</h2>
      </div>

      <div className="grid grid-cols-2 gap-3 text-sm">
        <Metric label="输入要素" value={result.summary.inputFeatureCount ?? '未知'} />
        <Metric label="输出要素" value={result.summary.outputFeatureCount ?? '未知'} />
        <Metric label="Mock 模式" value={result.summary.mockMode ? '是' : '否'} />
        <Metric label="操作数" value={result.summary.operations.length} />
      </div>

      <UndoStatus undo={undo} />

      <div className="space-y-2 text-sm text-slate-300">
        {result.logs.map((log) => <p key={log} className="rounded-xl bg-slate-950/70 p-3">{log}</p>)}
        {result.warnings.map((warning) => <p key={warning} className="rounded-xl bg-amber-950/30 p-3 text-amber-100">{warning}</p>)}
      </div>

      {downloadUrl ? (
        <a
          className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300"
          download={result.fileName}
          href={downloadUrl}
        >
          <Download className="size-4" />
          下载 GeoJSON
        </a>
      ) : null}
    </section>
  );
}

function Metric({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-2xl bg-slate-950/70 p-3">
      <p className="text-xs text-slate-500">{label}</p>
      <p className="mt-1 text-sm font-medium text-slate-100">{value}</p>
    </div>
  );
}
