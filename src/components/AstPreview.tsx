import { Code } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { GeoSurgicalAst } from '../types/ast';

type AstPreviewProps = {
  ast: GeoSurgicalAst | null;
  risks: string[];
};

export function AstPreview({ ast, risks }: AstPreviewProps) {
  const { t } = useI18n();

  if (!ast) {
    return (
      <section className="flex items-center gap-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-xs text-zinc-400">
        <Code className="size-4 shrink-0" />
        {t('ast.empty')}
      </section>
    );
  }

  return (
    <section className="animate-fade-in space-y-2 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium text-zinc-600">{t('ast.title')}</h2>
        <span className="rounded border border-zinc-200 bg-zinc-100 px-1.5 py-0.5 text-[10px] text-zinc-500">v{ast.version}</span>
      </div>
      <pre className="max-h-60 overflow-auto rounded-md bg-zinc-100 p-3 text-[11px] leading-relaxed text-zinc-600 font-mono">
        {JSON.stringify(ast, null, 2)}
      </pre>
      {risks.length ? (
        <div className="space-y-0.5 rounded-md border border-amber-300 bg-amber-50 p-2.5 text-[11px] text-amber-700">
          {risks.map((risk) => <p key={risk}>{t(risk)}</p>)}
        </div>
      ) : null}
    </section>
  );
}
