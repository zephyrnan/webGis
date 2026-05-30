import { useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { isSupportedGisFile, SUPPORTED_EXTENSIONS } from '../services/fileGuards';
import { isTauriRuntime } from '../services/tauriRuntime';
import type { StructuredError } from '../types/protocol';

type DropzoneProps = {
  disabled?: boolean;
  multiple?: boolean;
  onFile(file: File): void;
  onError(error: StructuredError): void;
};

export function Dropzone({ disabled, multiple, onFile, onError }: DropzoneProps) {
  const { language, t } = useI18n();
  const [isPicking, setIsPicking] = useState(false);
  const tauri = isTauriRuntime();

  const handleFiles = (files: FileList | null) => {
    if (!files || files.length === 0) return;

    for (const file of Array.from(files)) {
      if (!isSupportedGisFile(file.name)) {
        onError({
          code: 'UNSUPPORTED_FILE_TYPE',
          message: language === 'zh'
            ? `暂不支持 ${file.name}，请上传 ${SUPPORTED_EXTENSIONS.join(' / ')}。`
            : `${file.name} is not supported. Upload ${SUPPORTED_EXTENSIONS.join(' / ')} instead.`,
          recoverable: true,
        });
        return;
      }
    }

    for (const file of Array.from(files)) {
      onFile(file);
    }
  };

  const handleTauriOpen = async () => {
    if (disabled || isPicking) return;

    setIsPicking(true);
    try {
      const [{ open }, { invoke }] = await Promise.all([
        import('@tauri-apps/plugin-dialog'),
        import('@tauri-apps/api/core'),
      ]);
      const selected = await open({
        multiple: Boolean(multiple),
        filters: [{ name: 'GIS files', extensions: ['geojson', 'json', 'zip', 'shp'] }],
      });

      if (!selected) return;

      const paths = Array.isArray(selected) ? selected : [selected];
      for (const path of paths) {
        const fileName = path.split(/[\\/]/).pop() ?? path;
        const bytes = await invoke<ArrayBuffer>('read_local_file', { path });
        if (!isSupportedGisFile(fileName)) {
          onError({
            code: 'UNSUPPORTED_FILE_TYPE',
            message: language === 'zh'
              ? `暂不支持 ${fileName}，请上传 ${SUPPORTED_EXTENSIONS.join(' / ')}。`
              : `${fileName} is not supported. Upload ${SUPPORTED_EXTENSIONS.join(' / ')} instead.`,
            recoverable: true,
          });
          return;
        }
        onFile(new File([bytes], fileName));
      }
    } catch (error) {
      onError({
        code: 'TAURI_FILE_OPEN_FAILED',
        message: error instanceof Error ? error.message : String(error),
        recoverable: true,
      });
    } finally {
      setIsPicking(false);
    }
  };

  return (
    <div className="space-y-2">
      <label
      role="button"
      aria-label={t('dropzone.title')}
      tabIndex={0}
      className="group flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center transition hover:border-zinc-400 hover:bg-zinc-100"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          (event.currentTarget.querySelector('input[type=file]') as HTMLInputElement)?.click();
        }
      }}
    >
      <UploadCloud className="mb-2 size-6 text-zinc-400 group-hover:text-zinc-600 transition" />
      <span className="text-xs font-medium text-zinc-600">{t('dropzone.title')}</span>
      <span className="mt-1 text-[11px] text-zinc-400">{t('dropzone.subtitle')}</span>
      <input
        className="hidden"
        disabled={disabled}
        type="file"
        accept=".geojson,.json,.zip,.shp"
        multiple={multiple}
        aria-label={t('dropzone.title')}
        onChange={(event) => handleFiles(event.target.files)}
      />
      </label>
      {tauri && (
        <button
          className="w-full rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-600 transition hover:border-zinc-400 hover:text-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
          type="button"
          disabled={disabled || isPicking}
          onClick={handleTauriOpen}
        >
          {isPicking ? t('dropzone.opening') : t('dropzone.selectLocal')}
        </button>
      )}
    </div>
  );
}
