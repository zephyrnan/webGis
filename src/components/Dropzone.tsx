import { UploadCloud } from 'lucide-react';
import { useI18n } from '../i18n/I18nContext';
import { isSupportedGisFile, SUPPORTED_EXTENSIONS } from '../services/fileGuards';
import type { StructuredError } from '../types/protocol';

type DropzoneProps = {
  disabled?: boolean;
  multiple?: boolean;
  onFile(file: File): void;
  onError(error: StructuredError): void;
};

export function Dropzone({ disabled, multiple, onFile, onError }: DropzoneProps) {
  const { language, t } = useI18n();

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

  return (
    <label
      className="group flex min-h-48 cursor-pointer flex-col items-center justify-center rounded-3xl border border-dashed border-slate-600 bg-slate-900/70 p-6 text-center transition hover:border-cyan-400 hover:bg-cyan-950/30"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) handleFiles(event.dataTransfer.files);
      }}
    >
      <UploadCloud className="mb-4 size-10 text-cyan-300" />
      <span className="text-lg font-semibold text-white">{t('dropzone.title')}</span>
      <span className="mt-2 text-sm text-slate-400">{t('dropzone.subtitle')}</span>
      <input
        className="hidden"
        disabled={disabled}
        type="file"
        accept=".geojson,.json,.zip,.shp"
        multiple={multiple}
        onChange={(event) => handleFiles(event.target.files)}
      />
    </label>
  );
}
