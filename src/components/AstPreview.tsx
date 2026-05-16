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
      <section className="rounded-3xl border border-slate-800 bg-slate-900/70 p-5 text-sm text-slate-500">
        {t('ast.empty')}
      </section>
    );
  }

  return (
    <section className="space-y-3 rounded-3xl border border-slate-800 bg-slate-900/70 p-5">
      <div className="flex items-center justify-between">
        <h2 className="font-semibold text-white">{t('ast.title')}</h2>
        <span className="rounded-full bg-cyan-950 px-2 py-1 text-xs text-cyan-200">v{ast.version}</span>
      </div>
      <pre className="max-h-72 overflow-auto rounded-2xl bg-slate-950 p-4 text-xs text-slate-200">
        {JSON.stringify(ast, null, 2)}
      </pre>
      {risks.length ? (
        <div className="space-y-1 rounded-2xl border border-amber-400/30 bg-amber-950/30 p-3 text-sm text-amber-100">
          {risks.map((risk) => <p key={risk}>{t(risk)}</p>)}
        </div>
      ) : null}
    </section>
  );
}
