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

  // Update suggestions as user types
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
    // Restore cursor position after React re-render
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

      // Multi-step: split by `;` or ` then `
      const segments = command.split(/;\s*|\s+then\s+/i).map((s) => s.trim()).filter(Boolean);

      if (segments.length === 0) {
        onError({ code: 'EMPTY_COMMAND', message: t('error.EMPTY_COMMAND'), recoverable: true });
        return;
      }

      if (segments.length === 1) {
        // Single command — original path
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
        // Multi-step: plan each segment, merge operations
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

        // Deduplicate consecutive export operations — keep only the last one
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
    <section className="space-y-4 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div>
        <h2 className="text-lg font-semibold text-white">{t('command.title')}</h2>
      </div>

      <div className="relative">
        <textarea
          ref={textareaRef}
          className="min-h-28 w-full resize-none rounded-2xl border border-slate-700 bg-slate-950 p-4 text-sm text-slate-100 outline-none transition placeholder:text-slate-600 focus:border-cyan-400"
          placeholder={metadata ? t('command.placeholder.ready') : t('command.placeholder.waiting')}
          value={command}
          onChange={(event) => onCommandChange(event.target.value)}
          onSelect={() => updateSuggestions()}
          onKeyDown={handleKeyDown}
        />
        {showSuggestions && suggestions.length > 0 && (
          <div className="absolute left-4 right-4 z-10 mt-1 max-h-48 overflow-auto rounded-xl border border-slate-700 bg-slate-900/95 shadow-xl shadow-black/40 backdrop-blur-sm">
            {suggestions.map((s, i) => (
              <button
                key={`${s.kind}-${s.label}`}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition ${
                  i === selectedSuggestion
                    ? 'bg-cyan-950/50 text-cyan-200'
                    : 'text-slate-300 hover:bg-slate-800'
                }`}
                type="button"
                onMouseDown={(e) => {
                  e.preventDefault();
                  acceptSuggestion(s);
                }}
              >
                <span className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium ${
                  s.kind === 'operation' ? 'bg-cyan-900/50 text-cyan-300' :
                  s.kind === 'field' ? 'bg-emerald-900/50 text-emerald-300' :
                  'bg-purple-900/50 text-purple-300'
                }`}>
                  {s.kind}
                </span>
                <span className="truncate font-mono">{s.label}</span>
              </button>
            ))}
            <div className="border-t border-slate-700/50 px-3 py-1.5 text-[10px] text-slate-600">
              <kbd className="rounded bg-slate-800 px-1 py-0.5">Tab</kbd> / <kbd className="rounded bg-slate-800 px-1 py-0.5">Enter</kbd> accept · <kbd className="rounded bg-slate-800 px-1 py-0.5">Esc</kbd> dismiss
            </div>
          </div>
        )}
      </div>

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
          onClick={() => plannedAst && onExecute(plannedAst, command)}
        >
          <Play className="size-4" />
          {t('command.execute')}
        </button>
        <button
          className="inline-flex items-center gap-2 rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-400 transition hover:border-emerald-400 hover:text-emerald-300 disabled:cursor-not-allowed disabled:text-slate-700"
          disabled={!plannedAst}
          type="button"
          onClick={() => void handleSaveTemplate()}
          title={t('template.save')}
        >
          <Save className="size-3.5" />
          {t('template.save')}
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

      <div className="space-y-2">
        <button
          className="flex items-center gap-2 text-xs text-slate-500 hover:text-slate-300"
          type="button"
          onClick={() => setShowTemplates((v) => !v)}
        >
          {t('template.title')}
          <span className="rounded-full bg-slate-800 px-1.5 py-0.5 text-[10px]">{templates.length}</span>
        </button>

        {showTemplates && (
          <div className="space-y-2">
            {templates.length > 0 ? (
              <ul className="space-y-1 max-h-48 overflow-auto">
                {templates.map((tpl) => (
                  <li key={tpl.id} className="group flex items-center gap-2 rounded-xl bg-slate-950/70 px-3 py-2">
                    <button
                      className="min-w-0 flex-1 text-left"
                      type="button"
                      onClick={() => handleLoadTemplate(tpl)}
                    >
                      <p className="truncate text-xs font-medium text-slate-200">{tpl.name}</p>
                      <p className="truncate text-[10px] text-slate-600">{tpl.command}</p>
                    </button>
                    <button
                      className="shrink-0 rounded p-1 text-slate-600 opacity-0 transition hover:text-red-400 group-hover:opacity-100"
                      type="button"
                      title={t('template.delete')}
                      onClick={() => void handleDeleteTemplate(tpl.id)}
                    >
                      <Trash2 className="size-3" />
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-[11px] text-slate-600">{t('template.empty')}</p>
            )}

            <div className="flex gap-2">
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-cyan-400 hover:text-cyan-300"
                type="button"
                onClick={handleExportTemplates}
                disabled={templates.length === 0}
              >
                <Download className="size-3" />
                {t('template.export')}
              </button>
              <button
                className="inline-flex items-center gap-1.5 rounded-full border border-slate-700 px-2.5 py-1 text-[11px] text-slate-400 hover:border-cyan-400 hover:text-cyan-300"
                type="button"
                onClick={() => fileInputRef.current?.click()}
              >
                <Upload className="size-3" />
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
