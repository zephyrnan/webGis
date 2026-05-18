import { AlertTriangle } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import type { StructuredError } from '../types/protocol';

type ErrorCalloutProps = {
  error: StructuredError | null;
};

function resolveI18nMessage(raw: string, t: (key: string, params?: Record<string, string | number>) => string): string {
  const qIndex = raw.indexOf('?');
  if (qIndex === -1) return t(raw) === raw ? raw : t(raw);
  const key = raw.slice(0, qIndex);
  const params = Object.fromEntries(new URLSearchParams(raw.slice(qIndex + 1)));
  const translated = t(key, params);
  return translated === key ? raw : translated;
}

export function ErrorCallout({ error }: ErrorCalloutProps) {
  const { t } = useI18n();

  if (!error) return null;

  const errorKey = `error.${error.code}`;
  const translatedCode = t(errorKey);
  const message = translatedCode === errorKey ? resolveI18nMessage(error.message, t) : translatedCode;

  return (
    <div className="rounded-2xl border border-amber-400/40 bg-amber-950/40 p-4 text-sm text-amber-100">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4" />
        {error.code}
      </div>
      <p className="mt-2 text-amber-50/90">{message}</p>
      {error.suggestedUserInput ? (
        <p className="mt-2 rounded-xl bg-black/20 p-2 text-amber-50">{t('error.suggestion')} {resolveI18nMessage(error.suggestedUserInput, t)}</p>
      ) : null}
    </div>
  );
}
