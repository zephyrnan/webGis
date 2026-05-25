import type { SurgeryResult } from '../types/protocol';

export type QualityReport = {
  featureChange: { input: number | null; output: number | null; delta: number | null };
  operations: string[];
  encodingFixed: boolean;
  encodingFrom: string | null;
  geometryIssues: { invalid: number; fixed: number };
  warnings: string[];
  mockMode: boolean;
};

export function buildQualityReport(result: SurgeryResult): QualityReport {
  const input = result.summary.inputFeatureCount;
  const output = result.summary.outputFeatureCount;
  const delta = input != null && output != null ? output - input : null;

  let encodingFixed = false;
  let encodingFrom: string | null = null;
  let geometryInvalid = 0;
  let geometryFixed = 0;

  for (const log of result.logs) {
    if (log.includes('fix_encoding')) {
      encodingFixed = true;
      const match = log.match(/encoding:\s*(\S+)/i) ?? log.match(/(\S+)\s*→/);
      if (match) encodingFrom = match[1];
    }
    const invalidMatch = log.match(/invalid:\s*(\d+)/);
    if (invalidMatch) geometryInvalid = parseInt(invalidMatch[1], 10);
    const fixedMatch = log.match(/fixed:\s*(\d+)/);
    if (fixedMatch) geometryFixed = parseInt(fixedMatch[1], 10);
  }

  return {
    featureChange: { input, output, delta },
    operations: result.summary.operations,
    encodingFixed,
    encodingFrom,
    geometryIssues: { invalid: geometryInvalid, fixed: geometryFixed },
    warnings: result.warnings.filter((w) => !w.startsWith('WASM_')),
    mockMode: result.summary.mockMode,
  };
}
