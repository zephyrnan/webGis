import type { GeoSurgicalWasm, MetadataInputContext, ExecuteInputContext } from './geosurgicalWasm';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { ProgressEvent } from '../types/protocol';

let enginePromise: Promise<any> | null = null;
let engineInstance: any = null;

async function loadEngine(): Promise<any> {
  if (engineInstance) return engineInstance;

  if (!enginePromise) {
    enginePromise = (async () => {
      const wasm = await import('@wasm/geosurgical');
      await wasm.default();
      engineInstance = new wasm.GeoSurgicalEngine();
      return engineInstance;
    })();
  }

  return enginePromise;
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
      const engine = await loadEngine();

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
