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
      className="group flex min-h-[120px] cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-4 text-center transition hover:border-zinc-400 hover:bg-zinc-100"
      onDragOver={(event) => event.preventDefault()}
      onDrop={(event) => {
        event.preventDefault();
        if (!disabled) handleFiles(event.dataTransfer.files);
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
        onChange={(event) => handleFiles(event.target.files)}
      />
    </label>
  );
}
