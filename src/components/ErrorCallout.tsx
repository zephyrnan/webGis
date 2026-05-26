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

  const translatedMessage = resolveI18nMessage(error.message, t);
  const errorKey = `error.${error.code}`;
  const translatedCode = t(errorKey);
  const message = translatedMessage === error.message && error.message === error.code && translatedCode !== errorKey
    ? translatedCode
    : translatedMessage;

  return (
    <div className="rounded-lg border border-amber-300 bg-amber-50 p-3 text-xs">
      <div className="flex items-center gap-1.5 font-medium text-amber-700">
        <AlertTriangle className="size-3.5" />
        {error.code}
      </div>
      <p className="mt-1.5 text-amber-600">{message}</p>
      {error.suggestedUserInput ? (
        <p className="mt-1.5 rounded-md bg-amber-100 p-2 text-amber-600">{t('error.suggestion')} {resolveI18nMessage(error.suggestedUserInput, t)}</p>
      ) : null}
    </div>
  );
}
