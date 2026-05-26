import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Play, Save, Sparkles, Trash2, Upload } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { BrainPlanningError, defaultBrainGateway } from '../services/brain';
import type { BrainGateway } from '../services/brain';
import { validateAst } from '../services/astValidation';
import { getSuggestions, applySuggestion } from '../services/autocomplete';
import type { Suggestion } from '../services/autocomplete';
import { loadTemplates, saveTemplate, deleteTemplate, exportTemplates, importTemplates } from '../services/templates';
import type { AstTemplate } from '../services/templates';
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
  onExecute(ast: GeoSurgicalAst, command?: string): void;
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
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [selectedSuggestion, setSelectedSuggestion] = useState(0);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [templates, setTemplates] = useState<AstTemplate[]>([]);
  const [showTemplates, setShowTemplates] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const gateway = brainGateway ?? defaultBrainGateway;
  const canPlan = Boolean(metadata && command.trim()) && !disabled && !isPlanning;

  const updateSuggestions = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !metadata) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    const cursorPos = textarea.selectionStart;
    const newSuggestions = getSuggestions(command, cursorPos, metadata);
    setSuggestions(newSuggestions);
    setSelectedSuggestion(0);
    setShowSuggestions(newSuggestions.length > 0);
  }, [command, metadata]);

  useEffect(() => {
    updateSuggestions();
  }, [updateSuggestions]);

  useEffect(() => {
    void loadTemplates().then(setTemplates);
  }, []);

  const handleSaveTemplate = async () => {
    if (!plannedAst) return;
    const name = prompt(t('template.namePrompt'));
    if (!name) return;
    const template: AstTemplate = {
      id: crypto.randomUUID(),
      name,
      ast: plannedAst,
      command,
      createdAt: Date.now(),
    };
    await saveTemplate(template);
    setTemplates((prev) => [...prev, template]);
  };

  const handleDeleteTemplate = async (id: string) => {
    await deleteTemplate(id);
    setTemplates((prev) => prev.filter((t) => t.id !== id));
  };

  const handleLoadTemplate = (template: AstTemplate) => {
    onCommandChange(template.command);
    setPlannedAst(template.ast);
    setRisks([]);
    onAstReady(template.ast, []);
    setShowTemplates(false);
  };

  const handleExportTemplates = () => {
    const json = exportTemplates(templates);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'geosurgical-templates.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleImportTemplates = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    try {
      const imported = importTemplates(text);
      for (const tpl of imported) {
        await saveTemplate(tpl);
      }
      setTemplates((prev) => [...prev, ...imported]);
    } catch {
      onError({ code: 'IMPORT_ERROR', message: t('template.importError'), recoverable: true });
    }
    e.target.value = '';
  };

  const acceptSuggestion = useCallback((suggestion: Suggestion) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const cursorPos = textarea.selectionStart;
    const { text, cursorPos: newPos } = applySuggestion(command, cursorPos, suggestion);
    onCommandChange(text);
    setShowSuggestions(false);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(newPos, newPos);
    });
  }, [command, onCommandChange]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (showSuggestions && suggestions.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev + 1) % suggestions.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setSelectedSuggestion((prev) => (prev - 1 + suggestions.length) % suggestions.length);
        return;
      }
      if (e.key === 'Tab' || (e.key === 'Enter' && !e.shiftKey)) {
        e.preventDefault();
        acceptSuggestion(suggestions[selectedSuggestion]);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setShowSuggestions(false);
        return;
      }
    }
  };

  const planCommand = async () => {
    if (!metadata) return;

    try {
      setIsPlanning(true);
      onError(null);

      const segments = command.split(/;\s*|\s+then\s+/i).map((s) => s.trim()).filter(Boolean);

      if (segments.length === 0) {
        onError({ code: 'EMPTY_COMMAND', message: t('error.EMPTY_COMMAND'), recoverable: true });
        return;
      }

      if (segments.length === 1) {
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
      } else {
        const allOperations: GeoSurgicalAst['operations'] = [];
        let targetLayer: string | undefined;
        const allRisks: string[] = [];

        for (const segment of segments) {
          const ast = await gateway.plan({ command: segment, metadata, schemaVersion: '1.0' });
          const validation = validateAst(ast, metadata);
          if (!validation.ok) {
            setPlannedAst(null);
            setRisks([]);
            onAstReady(null, []);
            onError(validation.error);
            return;
          }
          allOperations.push(...validation.ast.operations);
          allRisks.push(...validation.risks);
          if (!targetLayer && validation.ast.target_layer) {
            targetLayer = validation.ast.target_layer;
          }
        }

        const merged: GeoSurgicalAst['operations'] = [];
        for (const op of allOperations) {
          if (op.action === 'export' && merged.length > 0 && merged[merged.length - 1].action === 'export') {
            merged[merged.length - 1] = op;
          } else {
            merged.push(op);
          }
        }

        const mergedAst: GeoSurgicalAst = {
          version: '1.0',
          operations: merged,
          target_layer: targetLayer,
        };
        setPlannedAst(mergedAst);
        setRisks([...new Set(allRisks)]);
        onAstReady(mergedAst, [...new Set(allRisks)]);
      }

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
    <section className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <h2 className="text-xs font-medium text-zinc-600">{t('command.title')}</h2>

      <div className="relative">
        <textarea
          ref={textareaRef}
          className="min-h-[72px] w-full resize-none rounded-md border border-zinc-300 bg-white p-3 text-xs text-zinc-800 outline-none transition placeholder:text-zinc-400 focus:border-zinc-400 font-mono"
          placeholder={metadata ? t('command.placeholder.ready') : t('command.placeholder.waiting')}
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
          onSelect={() => updateSuggestions()}
          onKeyDown={handleKeyDown}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-0 right-0 z-10 mt-1 max-h-40 overflow-auto rounded-md border border-zinc-200 bg-white shadow-lg shadow-zinc-200/50">
            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.label}`}
                className={`flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-[11px] transition ${
                  i === selectedSuggestion
                    ? 'bg-zinc-100 text-zinc-900'
                    : 'text-zinc-500 hover:bg-zinc-50'
                }`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptSuggestion(s);
                }}
              >
                <span className={`shrink-0 rounded px-1 py-px text-[9px] font-medium ${
                  s.kind === 'operation' ? 'bg-zinc-200 text-zinc-600' :
                  s.kind === 'field' ? 'bg-zinc-200 text-zinc-600' :
                  'bg-zinc-200 text-zinc-600'
                }`}>
                  {s.kind}
                </span>
                <span className="truncate font-mono">{s.label}</span>
              </button>
            ))}
            <div className="border-t border-zinc-200 px-2.5 py-1 text-[9px] text-zinc-400">
              <kbd className="rounded bg-zinc-100 px-1 py-px">Tab</kbd> / <kbd className="rounded bg-zinc-100 px-1 py-px">Enter</kbd> · <kbd className="rounded bg-zinc-100 px-1 py-px">Esc</kbd>
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap gap-1.5">
        <button
          className="inline-flex items-center gap-1.5 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:cursor-not-allowed disabled:bg-zinc-200 disabled:text-zinc-400"
          disabled={!canPlan}
          type="button"
          onClick={planCommand}
        >
          <Sparkles className={`size-3.5 ${isPlanning ? 'animate-spin' : ''}`} />
          {isPlanning ? t('command.planning') : t('command.generateAst')}
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-3 py-1.5 text-xs text-zinc-600 transition hover:border-zinc-400 disabled:cursor-not-allowed disabled:text-zinc-300"
          disabled={!plannedAst || disabled}
          type="button"
          onClick={() => plannedAst && onExecute(plannedAst, command)}
        >
          <Play className="size-3.5" />
          {t('command.execute')}
        </button>
        <button
          className="inline-flex items-center gap-1.5 rounded-md border border-zinc-300 px-2 py-1.5 text-[10px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700 disabled:cursor-not-allowed disabled:text-zinc-300"
          disabled={!plannedAst}
          type="button"
          onClick={() => void handleSaveTemplate()}
          title={t('template.save')}
        >
          <Save className="size-3" />
          {t('template.save')}
        </button>
      </div>

      {risks.length ? (
        <p className="rounded-md border border-amber-300 bg-amber-50 p-2 text-[11px] text-amber-700">
          {t('command.risky')}
        </p>
      ) : null}

      {history.length ? (
        <div className="space-y-1">
          <p className="text-[10px] text-zinc-400">{t('command.history')}</p>
          <div className="flex flex-wrap gap-1">
            {history.map((item) => (
              <button
                key={item}
                className="rounded-md bg-zinc-100 px-2 py-1 text-[10px] text-zinc-500 font-mono hover:text-zinc-700 transition"
                type="button"
                onClick={() => onCommandChange(item)}
              >
                {item}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="space-y-1.5">
        <button
          className="flex items-center gap-1.5 text-[10px] text-zinc-400 hover:text-zinc-600 transition"
          type="button"
          onClick={() => setShowTemplates((v) => !v)}
        >
          {t('template.title')}
          <span className="rounded bg-zinc-100 px-1 py-px text-[9px]">{templates.length}</span>
        </button>

        {showTemplates && (
          <div className="space-y-1.5">
            {templates.length > 0 ? (
              <ul className="space-y-0.5 max-h-40 overflow-y-auto">
                {templates.map((tpl) => (
                  <li key={tpl.id} className="group flex items-center gap-1.5 rounded-md bg-zinc-100 px-2 py-1.5">
                    <button
                      className="min-w-0 flex-1 text-left"
                      type="button"
                      onClick={() => handleLoadTemplate(tpl)}
                    >
                      <p className="truncate text-[11px] font-medium text-zinc-700">{tpl.name}</p>
                      <p className="truncate text-[10px] text-zinc-400 font-mono">{tpl.command}</p>
                    </button>
                    <button
                      className="shrink-0 rounded p-0.5 text-zinc-400 opacity-0 transition hover:text-red-500 group-hover:opacity-100"
                      type="button"
                      title={t('template.delete')}
                      onClick={() => void handleDeleteTemplate(tpl.id)}
                    >
                      <Trash2 className="size-2.5" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[10px] text-zinc-300">{t('template.empty')}</p>
            )}

            <div className="flex gap-1">
              <button
                className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
                type="button"
                onClick={handleExportTemplates}
                disabled={templates.length === 0}
              >
                <Download className="size-2.5" />
                {t('template.export')}
              </button>
              <button
                className="inline-flex items-center gap-1 rounded-md border border-zinc-300 px-2 py-0.5 text-[10px] text-zinc-500 hover:border-zinc-400 hover:text-zinc-700"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-2.5" />
                {t('template.import')}
              </button>
              <input
                ref={fileInputRef}
                className="hidden"
                type="file"
                accept=".json"
                onChange={(e) => void handleImportTemplates(e)}
              />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
