import type { UndoCapability } from '../types/protocol';

type UndoStatusProps = {
  undo: UndoCapability | null;
};

export function UndoStatus({ undo }: UndoStatusProps) {
  if (!undo) return null;

  return (
    <div className="rounded-2xl border border-slate-700 bg-slate-950/70 p-3 text-sm text-slate-300">
      <span className="font-medium text-slate-100">撤销能力：</span>
      {undo.available ? '可用' : '不可用'} · {undo.strategy}
      {undo.reason ? ` · ${undo.reason}` : ''}
    </div>
  );
}
