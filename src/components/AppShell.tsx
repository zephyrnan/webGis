import { useMemo, useState } from 'react';
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
  const worker = useGeoSurgicalWorker();
  const [command, setCommand] = useState('');
  const [localError, setLocalError] = useState<StructuredError | null>(null);
  const [ast, setAst] = useState<GeoSurgicalAst | null>(null);
  const [risks, setRisks] = useState<string[]>([]);
  const shortcutTags = useMemo(() => worker.metadata ? buildShortcutTags(worker.metadata) : [], [worker.metadata]);
  const error = localError ?? worker.error;

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100">
      <div className="mx-auto flex w-full max-w-[1600px] flex-col gap-6 px-6 py-8">
        <header className="rounded-[2rem] border border-cyan-400/20 bg-gradient-to-br from-slate-900 to-cyan-950/40 p-8 shadow-2xl shadow-cyan-950/20">
          <p className="text-xs uppercase tracking-[0.36em] text-cyan-300">GeoSurgical</p>
          <h1 className="mt-3 max-w-4xl text-4xl font-bold tracking-tight text-white md:text-5xl">
            面向空间数据的语言驱动手术台
          </h1>
          <p className="mt-4 max-w-3xl text-slate-300">
            MVP 已把文件生命周期隔离到 Worker：React 主线程只负责接待和调度，不拆包、不解析 GIS 二进制、不把真实坐标交给 Brain。
          </p>
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
