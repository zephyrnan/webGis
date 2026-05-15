import { AlertTriangle } from 'lucide-react';
import type { StructuredError } from '../types/protocol';

type ErrorCalloutProps = {
  error: StructuredError | null;
};

export function ErrorCallout({ error }: ErrorCalloutProps) {
  if (!error) return null;

  return (
    <div className="rounded-2xl border border-amber-400/40 bg-amber-950/40 p-4 text-sm text-amber-100">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4" />
        {error.code}
      </div>
      <p className="mt-2 text-amber-50/90">{error.message}</p>
      {error.suggestedUserInput ? (
        <p className="mt-2 rounded-xl bg-black/20 p-2 text-amber-50">建议输入：{error.suggestedUserInput}</p>
      ) : null}
    </div>
  );
}
