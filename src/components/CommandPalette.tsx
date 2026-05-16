import { useState } from 'react';
import { Play, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { BrainPlanningError, defaultBrainGateway } from '../services/brain';
import type { BrainGateway } from '../services/brain';
import { validateAst } from '../services/astValidation';
import type { GeoSurgicalAst } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { StructuredError } from '../types/protocol';

type CommandPaletteProps = {
  metadata: GeoSurgicalMetadata | null;
  disabled?: boolean;
  command: string;
  brainGateway?: BrainGateway;
  onCommandChange(command: string): void;
  onAstReady(ast: GeoSurgicalAst | null, risks: string[]): void;
  onExecute(ast: GeoSurgicalAst): void;
  onError(error: StructuredError | null): void;
};

export function CommandPalette({
  metadata,
  disabled,
  command,
  brainGateway,
  onCommandChange,
  onAstReady,
  onExecute,
  onError,
}: CommandPaletteProps) {
  const { t } = useI18n();
  const [plannedAst, setPlannedAst] = useState<GeoSurgicalAst | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [risks, setRisks] = useState<string[]>([]);
  const [isPlanning, setIsPlanning] = useState(false);

  const gateway = brainGateway ?? defaultBrainGateway;
  const canPlan = Boolean(metadata && command.trim()) && !disabled && !isPlanning;

  const planCommand = async () => {
    if (!metadata) return;

    try {
      setIsPlanning(true);
      onError(null);
      const ast = await gateway.plan({ command, metadata, schemaVersion: '1.0' });
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
        : { code: 'BRAIN_ERROR', message: t('error.BRAIN_ERROR'), recoverable: true };
      setPlannedAst(null);
      setRisks([]);
      onAstReady(null, []);
      onError(structuredError);
    } finally {
      setIsPlanning(false);
    }
  };

  return (
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{t('command.title')}</h2>
      </div>

      <textarea
        className="min-h-28 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
        placeholder={metadata ? t('command.placeholder.ready') : t('command.placeholder.waiting')}
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
          <Sparkles className={`size-4 ${isPlanning ? 'animate-spin' : ''}`} />
          {isPlanning ? t('command.planning') : t('command.generateAst')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-full border border-slate-600 px-4 py-2 text-sm font-semibold text-slate-100 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:text-slate-600"
          disabled={!plannedAst || disabled}
          type="button"
          onClick={() => plannedAst && onExecute(plannedAst)}
        >
          <Play className="size-4" />
          {t('command.execute')}
        </button>
      </div>

      {risks.length ? (
        <p className="rounded-2xl border border-amber-400/30 bg-amber-950/30 p-3 text-sm text-amber-100">
          {t('command.risky')}
        </p>
      ) : null}

      {history.length ? (
        <div className="space-y-2">
          <p className="text-xs text-slate-500">{t('command.history')}</p>
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
