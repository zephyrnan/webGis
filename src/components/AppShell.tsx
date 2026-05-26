import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { StopCircle } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { Language } from '../i18n/locales';
import type { GeoSurgicalAst } from '../types/ast';
import type { GeoLayer } from '../types/layer';
import type { StructuredError } from '../types/protocol';
import type { PersistedSession } from '../services/history';
import { buildShortcutTags } from '../services/shortcutTags';
import { LlmBrainGateway } from '../services/llmBrain';
import type { BrainGateway } from '../services/brain';
import { useGeoSurgicalWorker } from '../hooks/useGeoSurgicalWorker';
import { useBatchProcessor } from '../hooks/useBatchProcessor';
import { AstPreview } from './AstPreview';
import { CommandPalette } from './CommandPalette';
import { Dropzone } from './Dropzone';
import { HistoryPanel } from './HistoryPanel';
import { BatchPanel } from './BatchPanel';
import { ErrorCallout } from './ErrorCallout';
import { MetadataPanel } from './MetadataPanel';
import { ProgressTimeline } from './ProgressTimeline';
import { ResultPanel } from './ResultPanel';
import { ShortcutTags } from './ShortcutTags';

const MapPreview = lazy(() => import('./MapPreview').then(m => ({ default: m.MapPreview })));

const llmEndpoint = import.meta.env.VITE_LLM_ENDPOINT as string | undefined;
const llmApiKey = import.meta.env.VITE_LLM_API_KEY as string | undefined;
const llmModel = import.meta.env.VITE_LLM_MODEL as string | undefined;
const brainMode = import.meta.env.VITE_BRAIN_MODE as string | undefined;

const brainGateway: BrainGateway | undefined = brainMode !== 'mock' && llmEndpoint
  ? new LlmBrainGateway({ endpoint: llmEndpoint, apiKey: llmApiKey, model: llmModel ?? 'qwen2.5:7b' })
  : undefined;

export function AppShell() {
  const { language, setLanguage, t } = useI18n();
  const worker = useGeoSurgicalWorker();
  const batch = useBatchProcessor();
  const [command, setCommand] = useState('');
  const [localError, setLocalError] = useState<StructuredError | null>(null);
  const [ast, setAst] = useState<GeoSurgicalAst | null>(null);
  const [risks, setRisks] = useState<string[]>([]);
  const [selectedLayer, setSelectedLayer] = useState<string | null>(null);
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [layerVisibility, setLayerVisibility] = useState<Record<string, boolean>>({});
  const [layerExpanded, setLayerExpanded] = useState<Record<string, boolean>>({});

  const shortcutTags = useMemo(
    () => worker.metadata ? buildShortcutTags(worker.metadata, language) : [],
    [worker.metadata, language],
  );
  const error = localError ?? worker.error;

  // Build GeoLayer[] from metadata
  const layers: GeoLayer[] = useMemo(() => {
    if (!worker.metadata?.layers) return [];
    return worker.metadata.layers.map((layer) => ({
      id: layer.name,
      name: layer.name,
      featureCount: layer.featureCount ?? null,
      crs: layer.crs ?? null,
      encoding: layer.encoding ?? null,
      isVisible: layerVisibility[layer.name] ?? true,
      schema: layer.fields.map((f) => ({ field: f.name, type: f.type, sample: f.sample?.[0] })),
      isExpanded: layerExpanded[layer.name] ?? false,
    }));
  }, [worker.metadata, layerVisibility, layerExpanded]);

  const handleFile = useCallback((file: File) => {
    setLocalError(null);
    setAst(null);
    setRisks([]);
    setSelectedLayer(null);
    setLayerVisibility({});
    setLayerExpanded({});
    void worker.uploadFile(file);
  }, [worker]);

  const handleBatchFile = useCallback((file: File) => {
    setPendingFiles((prev) => [...prev, file]);
  }, []);

  const startBatch = useCallback(() => {
    if (pendingFiles.length === 0 || !ast) return;
    const finalAst = selectedLayer
      ? { ...ast, target_layer: selectedLayer }
      : ast;
    batch.startBatch(pendingFiles, finalAst);
    setPendingFiles([]);
  }, [pendingFiles, ast, batch, selectedLayer]);

  const toggleLayerVisibility = useCallback((name: string) => {
    setLayerVisibility((prev) => ({ ...prev, [name]: !(prev[name] ?? true) }));
  }, []);

  const toggleLayerExpand = useCallback((name: string) => {
    setLayerExpanded((prev) => ({ ...prev, [name]: !(prev[name] ?? false) }));
  }, []);

  return (
    <div className="h-screen w-full flex flex-col overflow-hidden bg-white text-zinc-900">
      {/* Header */}
      <header className="shrink-0 flex items-center justify-between border-b border-zinc-200 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-semibold tracking-tight text-zinc-900">
            {t('app.title')}
          </h1>
          <span
            className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-medium ${
              worker.engineMode === 'real'
                ? 'border-emerald-300 bg-emerald-50 text-emerald-700'
                : worker.engineMode === 'mock'
                  ? 'border-amber-300 bg-amber-50 text-amber-700'
                  : 'border-zinc-300 bg-zinc-100 text-zinc-500'
            }`}
            title={worker.wasmError ?? undefined}
          >
            <span className={`size-1.5 rounded-full ${
              worker.engineMode === 'real' ? 'bg-emerald-500' : worker.engineMode === 'mock' ? 'bg-amber-500' : 'bg-zinc-400 animate-pulse'
            }`} />
            {t(`engine.${worker.engineMode}`)}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <select
            className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-[11px] text-zinc-600 outline-none transition hover:border-zinc-400 focus:border-zinc-400"
            value={language}
            onChange={(e) => setLanguage(e.target.value as Language)}
          >
            {(['zh', 'en', 'ja', 'ko', 'fr', 'es'] as const).map((item) => (
              <option key={item} value={item}>{t(`language.${item}`)}</option>
            ))}
          </select>
        </div>
      </header>

      {/* Main content: 12-col grid */}
      <main className="flex-1 min-h-0 grid grid-cols-12 gap-px bg-zinc-200">
        {/* Left panel: Data Flow — 3 cols */}
        <div className="col-span-3 flex flex-col gap-px bg-zinc-200 overflow-hidden">
          {/* Dropzone / Pending files */}
          <div className="shrink-0 bg-white p-3">
            {batch.batch.running ? null : pendingFiles.length > 0 ? (
              <div className="space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-[11px] text-zinc-500">{t('dropzone.title')}</p>
                <Dropzone
                  multiple
                  disabled={!ast}
                  onError={setLocalError}
                  onFile={handleBatchFile}
                />
                <div className="flex gap-1.5">
                  <button
                    className="flex-1 rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-zinc-700 disabled:opacity-40"
                    type="button"
                    disabled={!ast || pendingFiles.length === 0}
                    onClick={startBatch}
                  >
                    {t('batch.title')} ({pendingFiles.length})
                  </button>
                  <button
                    className="rounded-md border border-zinc-300 px-2.5 py-1.5 text-[11px] text-zinc-500 transition hover:border-zinc-400 hover:text-zinc-700"
                    type="button"
                    onClick={() => setPendingFiles([])}
                  >
                    {t('batch.clear')}
                  </button>
                </div>
                <ul className="max-h-20 space-y-0.5 overflow-y-auto text-[11px] text-zinc-400">
                  {pendingFiles.map((f, i) => <li key={`${f.name}-${i}`} className="truncate">{f.name}</li>)}
                </ul>
              </div>
            ) : (
              <Dropzone
                disabled={worker.status === 'uploading' || worker.status === 'metadata-extracting' || worker.status === 'executing'}
                onError={setLocalError}
                onFile={handleFile}
              />
            )}
          </div>

          {/* File info + Layer tree — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto bg-white p-3 space-y-3">
            <MetadataPanel
              metadata={worker.metadata}
              selectedLayer={selectedLayer}
              layers={layers}
              onSelectLayer={(name) => {
                setSelectedLayer(name);
                worker.selectLayer(name);
              }}
              onToggleVisibility={toggleLayerVisibility}
              onToggleExpand={toggleLayerExpand}
            />
            <BatchPanel
              batch={batch.batch}
              onCancel={batch.cancelBatch}
              onClear={batch.clearBatch}
              onItemClick={(item) => {
                if (item.result) {
                  worker.setResult(item.result);
                }
              }}
            />
          </div>
        </div>

        {/* Center panel: Visualization — 5 cols */}
        <div className="col-span-5 flex flex-col gap-px bg-zinc-200 overflow-hidden">
          {/* Error + Shortcut tags — compact, shrink-0 */}
          <div className="shrink-0 bg-white p-3 space-y-2">
            <ErrorCallout error={error} />
            <ShortcutTags tags={shortcutTags} onPick={setCommand} />
          </div>

          {/* Map canvas — fills remaining space */}
          <div className="flex-1 min-h-0 bg-white p-3 pt-0">
            <div className="h-full rounded-lg overflow-hidden border border-zinc-200">
              <Suspense fallback={<div className="flex h-full items-center justify-center bg-zinc-50 text-xs text-zinc-400">{t('map.loading')}</div>}>
                <MapPreview result={worker.result} />
              </Suspense>
            </div>
          </div>
        </div>

        {/* Right panel: Control Flow — 4 cols */}
        <div className="col-span-4 flex flex-col gap-px bg-zinc-200 overflow-hidden">
          {/* Command palette — shrink-0 */}
          <div className="shrink-0 bg-white p-3">
            <CommandPalette
              command={command}
              disabled={worker.status === 'executing'}
              metadata={worker.metadata}
              brainGateway={brainGateway}
              onAstReady={(nextAst, nextRisks) => {
                setAst(nextAst);
                setRisks(nextRisks);
              }}
              onCommandChange={setCommand}
              onError={setLocalError}
              onExecute={(execAst, execCommand) => {
                const finalAst = selectedLayer
                  ? { ...execAst, target_layer: selectedLayer }
                  : execAst;
                worker.executeAst(finalAst, execCommand);
              }}
            />
            {worker.status === 'executing' && (
              <button
                className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-red-300 bg-red-50 px-3 py-1.5 text-xs text-red-600 transition hover:border-red-400 hover:text-red-700"
                type="button"
                onClick={worker.cancelTask}
              >
                <StopCircle className="size-3.5" />
                {t('command.cancel')}
              </button>
            )}
          </div>

          {/* AST Preview + Progress — scrollable */}
          <div className="flex-1 min-h-0 overflow-y-auto bg-white p-3 space-y-3">
            <AstPreview ast={ast} risks={risks} />
            <ProgressTimeline items={worker.progress} />
          </div>

          {/* History + Result — scrollable, fixed max height */}
          <div className="shrink-0 max-h-[45vh] overflow-y-auto bg-white p-3 space-y-3">
            <HistoryPanel
              onLoadSession={(session: PersistedSession) => {
                setAst(session.ast);
                setCommand(session.command);
                setRisks([]);
                worker.executeAst(session.ast, session.command);
              }}
            />
            <ResultPanel
              result={worker.result}
              history={worker.history.entries}
              historyIndex={worker.history.currentIndex}
              onUndo={worker.undoHistory}
              onRedo={worker.redoHistory}
              onJumpTo={worker.jumpToHistory}
            />
          </div>
        </div>
      </main>
    </div>
  );
}
