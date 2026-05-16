import { useMemo, useState } from 'react';
import { useI18n } from '../i18n/I18nContext';
import type { GeoSurgicalAst } from '../types/ast';
import type { StructuredError } from '../types/protocol';
import { buildShortcutTags } from '../services/shortcutTags';
import { useGeoSurgicalWorker } from '../hooks/useGeoSurgicalWorker';
import { AstPreview } from './AstPreview';
import { CommandPalette } from './CommandPalette';
import { Dropzone } from './Dropzone';
import { ErrorCallout } from './ErrorCallout';
import { MapPreview } from './MapPreview';
import { MetadataPanel } from './MetadataPanel';
import { ProgressTimeline } from './ProgressTimeline';
import { ResultPanel } from './ResultPanel';
import { ShortcutTags } from './ShortcutTags';

export function AppShell() {
  const { language, setLanguage, t } = useI18n();
  const worker = useGeoSurgicalWorker();
  const [command, setCommand] = useState('');
  const [localError, setLocalError] = useState<StructuredError | null>(null);
  const [ast, setAst] = useState<GeoSurgicalAst | null>(null);
  const [risks, setRisks] = useState<string[]>([]);
  const shortcutTags = useMemo(
    () => worker.metadata ? buildShortcutTags(worker.metadata, language) : [],
    [worker.metadata, language],
  );
  const error = localError ?? worker.error;

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
            <div className="inline-flex rounded-full border border-slate-700 bg-slate-950/70 p-1 text-sm">
              {(['zh', 'en'] as const).map((item) => (
                <button
                  key={item}
                  className={`rounded-full px-3 py-1.5 transition ${language === item ? 'bg-cyan-400 text-slate-950' : 'text-slate-300 hover:text-white'}`}
                  type="button"
                  onClick={() => setLanguage(item)}
                >
                  {t(item === 'zh' ? 'language.zh' : 'language.en')}
                </button>
              ))}
            </div>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[360px_minmax(420px,1fr)_520px]">
          <aside className="space-y-6">
            <Dropzone
              disabled={worker.status === 'uploading' || worker.status === 'metadata-extracting' || worker.status === 'executing'}
              onError={setLocalError}
              onFile={(file) => {
                setLocalError(null);
                setAst(null);
                setRisks([]);
                void worker.uploadFile(file);
              }}
            />
            <MetadataPanel metadata={worker.metadata} />
          </aside>

          <section className="space-y-6">
            <ErrorCallout error={error} />
            <ShortcutTags tags={shortcutTags} onPick={setCommand} />
            <CommandPalette
              command={command}
              disabled={worker.status === 'executing'}
              metadata={worker.metadata}
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
          </section>

          <section className="space-y-6">
            <MapPreview result={worker.result} />
            <ResultPanel result={worker.result} undo={worker.undo} />
          </section>
        </div>
      </div>
    </main>
  );
}
