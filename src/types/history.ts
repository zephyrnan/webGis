import type { GeoSurgicalAst } from './ast';
import type { SurgeryResult } from './protocol';

export type HistoryEntry = {
  id: string;
  fileName: string;
  command: string;
  ast: GeoSurgicalAst;
  resultSnapshot: SurgeryResult;
  timestamp: number;
};

export type HistoryState = {
  entries: HistoryEntry[];
  currentIndex: number;
};
