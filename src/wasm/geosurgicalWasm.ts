import type { GeoSurgicalAst } from '../types/ast';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { SurgeryResult, UndoCapability } from '../types/protocol';

export type MetadataInputContext = {
  fileName: string;
  fileSize: number;
};

export type ExecuteInputContext = MetadataInputContext & {
  metadata: GeoSurgicalMetadata;
};

export type SurgeryEnvelope = {
  result: SurgeryResult;
  undo: UndoCapability;
};

export interface GeoSurgicalWasm {
  extract_metadata(input: Uint8Array, context: MetadataInputContext): Promise<string> | string;
  execute_surgery(
    input: Uint8Array,
    jsonInstructions: string,
    context: ExecuteInputContext,
  ): Promise<Uint8Array> | Uint8Array;
}

export function decodeSurgeryEnvelope(bytes: Uint8Array): SurgeryEnvelope {
  return JSON.parse(new TextDecoder().decode(bytes)) as SurgeryEnvelope;
}

export function encodeSurgeryEnvelope(envelope: SurgeryEnvelope): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(envelope));
}

export function parseAst(jsonInstructions: string): GeoSurgicalAst {
  return JSON.parse(jsonInstructions) as GeoSurgicalAst;
}
