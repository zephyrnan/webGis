import { UploadCloud } from 'lucide-react';
import { isSupportedGisFile, SUPPORTED_EXTENSIONS } from '../services/fileGuards';
import type { StructuredError } from '../types/protocol';

type DropzoneProps = {
  disabled?: boolean;
  onFile(file: File): void;
  onError(error: StructuredError): void;
};

export function Dropzone({ disabled, onFile, onError }: DropzoneProps) {
  const handleFiles = (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;

    if (!isSupportedGisFile(file.name)) {
      onError({
        code: 'UNSUPPORTED_FILE_TYPE',
        message: `暂不支持 ${file.name}，请上传 ${SUPPORTED_EXTENSIONS.join(' / ')}。`,
        recoverable: true,
      });
      return;
    }

    onFile(file);
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
      <span className="text-lg font-semibold text-white">拖拽 GIS 文件到这里</span>
      <span className="mt-2 text-sm text-slate-400">支持 .geojson / .json / .zip / .shp，主线程只接收并转交 Worker。</span>
      <input
        className="hidden"
        disabled={disabled}
        type="file"
        accept=".geojson,.json,.zip,.shp"
        onChange={(event) => handleFiles(event.target.files)}
      />
    </label>
  );
}
