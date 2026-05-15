import { useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import { BrainPlanningError, defaultBrainGateway } from '../services/brain';
import { validateAst } from '../services/astValidation';
import type { GeoSurgicalAst } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { StructuredError } from '../types/protocol';

type CommandPaletteProps = {
  metadata: GeoSurgicalMetadata | null;
  disabled?: boolean;
  command: string;
  onCommandChange(command: string): void;
  onAstReady(ast: GeoSurgicalAst | null, risks: string[]): void;
  onExecute(ast: GeoSurgicalAst): void;
  onError(error: StructuredError | null): void;
};

export function CommandPalette({
  metadata,
  disabled,
  command,
  onCommandChange,
  onAstReady,
  onExecute,
  onError,
}: CommandPaletteProps) {
  const [plannedAst, setPlannedAst] = useState<GeoSurgicalAst | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [risks, setRisks] = useState<string[]>([]);

  const canPlan = Boolean(metadata && command.trim()) && !disabled;

  const planCommand = async () => {
    if (!metadata) return;

    try {
      onError(null);
      const ast = await defaultBrainGateway.plan({ command, metadata, schemaVersion: '1.0' });
      const validation = validateAst(ast, metadata);

      if (!validation.ok) {
        setPlannedAst(null);
        setRisks([]);
        onAstReady(null, []);
        onError(validation.error);
        return;
      }

      setPlannedAst(validation.ast);
      setRisks(validation.risks);
      onAstReady(validation.ast, validation.risks);
      setHistory((items) => [command, ...items.filter((item) => item !== command)].slice(0, 5));
    } catch (error) {
      const structuredError = error instanceof BrainPlanningError
        ? error.structuredError
        : { code: 'BRAIN_ERROR', message: '指令规划失败。', recoverable: true };
      setPlannedAst(null);
      setRisks([]);
      onAstReady(null, []);
      onError(structuredError);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <p className="text-xs uppercase tracking-[0.24em] text-cyan-300">Command Palette</p>
        <h2 className="mt-1 text-lg font-semibold text-white">用自然语言描述手术指令</h2>
      </div>

      <textarea
        className="min-h-28 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
        placeholder={metadata ? '例如：删除 name 字段为空的要素，然后导出 GeoJSON。' : '可以先写需求，但 Metadata 返回前不能执行。'}
        value={command}
        onChange={(event) => onCommandChange(event.target.value)}
      />

      <div className="flex flex-wrap gap-2">
        <button
          className="inline-flex items-center gap-2 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:cursor-not-allowed disabled:bg-slate-700 disabled:text-slate-400"
          disabled={!canPlan}
          type="button"
          onClick={planCommand}
        >
          <Sparkles className="size-4" />
          生成 AST
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:text-slate-600"
          disabled={!plannedAst || disabled}
          type="button"
          onClick={() => plannedAst && onExecute(plannedAst)}
        >
          <Play className="size-4" />
          确认执行
        </button>
      </div>

      {risks.length ? (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-950/30 p-3 text-sm text-amber-100">
          检测到高风险操作，请确认 AST 后再执行。
        </p>
      ) : null}

      {history.length ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">历史指令</p>
          <div className="flex flex-wrap gap-2">
            {history.map((item) => (
              <button
                key={item}
                className="rounded-full bg-slate-950 px-3 py-1.5 text-xs text-slate-300 hover:text-cyan-200"
                type="button"
                onClick={() => onCommandChange(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
