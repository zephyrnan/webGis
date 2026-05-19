import type { GeoSurgicalWasm, MetadataInputContext, ExecuteInputContext } from './geosurgicalWasm';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { ProgressEvent } from '../types/protocol';

// Cache the WASM module and initialization — only create fresh engine instances.
let wasmModulePromise: Promise<any> | null = null;
let engineInstance: any = null;

async function loadWasmModule() {
  if (!wasmModulePromise) {
    wasmModulePromise = (async () => {
      const wasm = await import('@wasm/geosurgical');
      await wasm.default();
      return wasm;
    })();
  }
  return wasmModulePromise;
}

async function loadEngine(): Promise<any> {
  if (engineInstance) return engineInstance;
  const wasm = await loadWasmModule();
  engineInstance = new wasm.GeoSurgicalEngine();
  return engineInstance;
}

type ProgressCallback = (progress: ProgressEvent) => void;

export function createRealGeoSurgicalWasm(onProgress?: ProgressCallback): GeoSurgicalWasm {
  return {
    async extract_metadata(input, context) {
      const engine = await loadEngine();

      if (onProgress) {
        engine.setProgressCallback((evt: any) => {
          onProgress({
            phase: evt.phase === 'metadata' ? 'metadata' : 'executing',
            message: evt.message,
            percent: evt.percent,
          });
        });
      }

      const result = engine.extractMetadata(input, context.fileName, context.fileSize);
      return result;
    },

    async execute_surgery(input, jsonInstructions, context) {
      // Create a fresh engine instance for surgery execution.
      // Reusing the singleton after extractMetadata on large files (100MB+)
      // causes the WASM allocator to hang — likely memory fragmentation.
      const wasm = await loadWasmModule();
      const engine = new wasm.GeoSurgicalEngine();

      if (onProgress) {
        engine.setProgressCallback((evt: any) => {
          onProgress({
            phase: evt.phase === 'executing' ? 'executing' : 'exporting',
            message: evt.message,
            percent: evt.percent,
          });
        });
      }

      const result = engine.executeSurgery(input, jsonInstructions, context.fileName, context.fileSize);
      return result;
    },
  };
}
