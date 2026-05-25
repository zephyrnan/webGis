import { Suspense, lazy, useCallback, useMemo, useState } from 'react';
import { StopCircle } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { Language } from '../i18n/locales';
import type { GeoSurgicalAst } from '../types/ast';
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
  const shortcutTags = useMemo(
    () => worker.metadata ? buildShortcutTags(worker.metadata, language) : [],
    [worker.metadata, language],
  );
  const error = localError ?? worker.error;

  const handleFile = useCallback((file: File) => {
    setLocalError(null);
    setAst(null);
    setRisks([]);
    setSelectedLayer(null);
    void worker.uploadFile(file);
  }, [worker]);

  const handleBatchFile = useCallback((file: File) => {
    setPendingFiles((prev) => [...prev, file]);
  }, []);

  const startBatch = useCallback(() => {
    if (pendingFiles.length === 0 || !ast) return;
    batch.startBatch(pendingFiles, ast);
    setPendingFiles([]);
  }, [pendingFiles, ast, batch]);

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-8">
        <header className="rounded-[2rem] border border-cyan-400/20 bg-gradient-to-br from-slate-900 to-cyan-950/40 p-8 shadow-2xl shadow-cyan-950/20">
          <div className="flex flex-col gap-5 md:flex-row md:items-start md:justify-between">
            <div>
              <h1 className="max-w-4xl text-4xl font-bold tracking-tight text-white md:text-5xl">
                {t('app.title')}
              </h1>
              <p className="mt-4 max-w-3xl text-slate-300">
                {t('app.subtitle')}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <span
                className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium ${
                  worker.engineMode === 'real'
                    ? 'border-emerald-400/40 bg-emerald-950/40 text-emerald-300'
                    : worker.engineMode === 'mock'
                      ? 'border-amber-400/40 bg-amber-950/40 text-amber-300'
                      : 'border-slate-600 bg-slate-800 text-slate-400'
                }`}
                title={worker.wasmError ?? undefined}
              >
                <span className={`size-1.5 rounded-full ${
                  worker.engineMode === 'real' ? 'bg-emerald-400' : worker.engineMode === 'mock' ? 'bg-amber-400' : 'bg-slate-500 animate-pulse'
                }`} />
                {t(`engine.${worker.engineMode}`)}
              </span>
              <select
                className="rounded-full border border-slate-700 bg-slate-950/70 px-3 py-1.5 text-sm text-slate-300 outline-none transition hover:border-cyan-400 focus:border-cyan-400"
                value={language}
                onChange={(e) => setLanguage(e.target.value as Language)}
              >
                {(['zh', 'en', 'ja', 'ko', 'fr', 'es'] as const).map((item) => (
                  <option key={item} value={item}>{t(`language.${item}`)}</option>
                ))}
              </select>
            </div>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(420px,1fr)_520px]">
          <aside className="space-y-6">
            {batch.batch.running ? null : pendingFiles.length > 0 ? (
              <div className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
                <p className="text-sm text-slate-300">{t('dropzone.title')}</p>
                <Dropzone
                  multiple
                  disabled={!ast}
                  onError={setLocalError}
                  onFile={handleBatchFile}
                />
                <div className="flex gap-2">
                  <button
                    className="flex-1 rounded-full bg-cyan-400 px-4 py-2 text-sm font-semibold text-slate-950 transition hover:bg-cyan-300 disabled:opacity-40"
                    type="button"
                    disabled={!ast || pendingFiles.length === 0}
                    onClick={startBatch}
                  >
                    {t('batch.title')} ({pendingFiles.length})
                  </button>
                  <button
                    className="rounded-full border border-slate-700 px-3 py-2 text-xs text-slate-400 transition hover:border-slate-500 hover:text-slate-300"
                    type="button"
                    onClick={() => setPendingFiles([])}
                  >
                    {t('batch.clear')}
                  </button>
                </div>
                <ul className="max-h-32 space-y-1 overflow-y-auto text-xs text-slate-400">
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
            <MetadataPanel
              metadata={worker.metadata}
              selectedLayer={selectedLayer}
              onSelectLayer={(name) => {
                setSelectedLayer(name);
                worker.selectLayer(name);
              }}
            />
            <HistoryPanel
              onLoadSession={(session: PersistedSession) => {
                setAst(session.ast);
                setCommand(session.command);
                setRisks([]);
                worker.executeAst(session.ast, session.command);
              }}
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
          </aside>

          <section className="space-y-6">
            <ErrorCallout error={error} />
            <ShortcutTags tags={shortcutTags} onPick={setCommand} />
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
              onExecute={worker.executeAst}
            />
            <AstPreview ast={ast} risks={risks} />
            <ProgressTimeline items={worker.progress} />
            {worker.status === 'executing' && (
              <button
                className="inline-flex items-center gap-2 rounded-full border border-red-500/40 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-300 transition hover:border-red-400 hover:text-red-200"
                type="button"
                onClick={worker.cancelTask}
              >
                <StopCircle className="size-4" />
                {t('command.cancel')}
              </button>
            )}
          </section>

          <section className="space-y-6">
            <Suspense fallback={<div className="flex h-[420px] items-center justify-center rounded-3xl border border-slate-800 bg-slate-900/70 text-sm text-slate-400">{t('map.loading')}</div>}>
              <MapPreview result={worker.result} />
            </Suspense>
            <ResultPanel
              result={worker.result}
              history={worker.history.entries}
              historyIndex={worker.history.currentIndex}
              onUndo={worker.undoHistory}
              onRedo={worker.redoHistory}
              onJumpTo={worker.jumpToHistory}
            />
          </section>
        </div>
      </div>
    </main>
  );
}
