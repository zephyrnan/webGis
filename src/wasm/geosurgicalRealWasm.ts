import type { GeoSurgicalWasm } from './geosurgicalWasm';
import type { ProgressEvent } from '../types/protocol';

interface WasmProgressEvent {
  phase?: string;
  message?: string;
  percent?: number;
}

interface WasmEngine {
  setProgressCallback(callback: (evt: WasmProgressEvent) => void): void;
  extractMetadata(input: Uint8Array, fileName: string, fileSize: number): string;
  executeSurgery(input: Uint8Array, jsonInstructions: string, fileName: string, fileSize: number): Uint8Array;
}

interface WasmModule {
  default(): Promise<unknown>;
  GeoSurgicalEngine: new () => WasmEngine;
}

// Cache the WASM module and initialization — only create fresh engine instances.
let wasmModulePromise: Promise<WasmModule> | null = null;
let engineInstance: WasmEngine | null = null;

async function loadWasmModule(): Promise<WasmModule> {
  if (wasmModulePromise) return wasmModulePromise;

  wasmModulePromise = (async () => {
    const wasm = await import('@wasm/geosurgical');
    await wasm.default();
    return wasm;
  })();

  return wasmModulePromise;
}

async function loadEngine(): Promise<WasmEngine> {
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
        engine.setProgressCallback((evt) => {
          onProgress({
            phase: evt.phase === 'metadata' ? 'metadata' : 'executing',
            message: evt.message ?? '',
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
        engine.setProgressCallback((evt) => {
          onProgress({
            phase: evt.phase === 'executing' ? 'executing' : 'exporting',
            message: evt.message ?? '',
            percent: evt.percent,
          });
        });
      }

      const result = engine.executeSurgery(input, jsonInstructions, context.fileName, context.fileSize);
      return result;
    },
  };
}
