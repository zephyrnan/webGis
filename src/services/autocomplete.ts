import type { GeoSurgicalMetadata } from '../types/metadata';

export type Suggestion = {
  label: string;
  kind: 'operation' | 'field' | 'layer';
  insertText: string;
};

const OPERATIONS: Suggestion[] = [
  { label: 'filter_area', kind: 'operation', insertText: 'filter_area' },
  { label: 'drop_empty', kind: 'operation', insertText: 'drop_empty' },
  { label: 'rename_field', kind: 'operation', insertText: 'rename_field' },
  { label: 'transform_crs', kind: 'operation', insertText: 'transform_crs' },
  { label: 'fix_encoding', kind: 'operation', insertText: 'fix_encoding' },
  { label: 'simplify', kind: 'operation', insertText: 'simplify' },
  { label: 'field_calculate', kind: 'operation', insertText: 'field_calculate' },
  { label: 'validate_geometry', kind: 'operation', insertText: 'validate_geometry' },
  { label: 'buffer', kind: 'operation', insertText: 'buffer' },
  { label: 'clip', kind: 'operation', insertText: 'clip' },
  { label: 'intersect', kind: 'operation', insertText: 'intersect' },
  { label: 'dissolve', kind: 'operation', insertText: 'dissolve' },
  { label: 'export', kind: 'operation', insertText: 'export' },
];

const MAX_SUGGESTIONS = 8;

export function getSuggestions(
  text: string,
  cursorPos: number,
  metadata: GeoSurgicalMetadata | null,
): Suggestion[] {
  // Find the word being typed (the token before cursor)
  const beforeCursor = text.slice(0, cursorPos);
  const match = beforeCursor.match(/[\w一-鿿]+$/);
  if (!match) return [];

  const prefix = match[0].toLowerCase();
  if (prefix.length < 2) return [];

  const results: Suggestion[] = [];

  // Match operations
  for (const op of OPERATIONS) {
    if (op.label.toLowerCase().includes(prefix)) {
      results.push(op);
    }
  }

  // Match field names
  if (metadata) {
    for (const field of metadata.fields) {
      if (field.name.toLowerCase().includes(prefix)) {
        results.push({ label: field.name, kind: 'field', insertText: field.name });
      }
    }

    // Match layer names
    if (metadata.layers) {
      for (const layer of metadata.layers) {
        if (layer.name.toLowerCase().includes(prefix)) {
          results.push({ label: layer.name, kind: 'layer', insertText: layer.name });
        }
      }
    }
  }

  // Deduplicate by label
  const seen = new Set<string>();
  return results.filter((s) => {
    if (seen.has(s.label)) return false;
    seen.add(s.label);
    return true;
  }).slice(0, MAX_SUGGESTIONS);
}

export function applySuggestion(
  text: string,
  cursorPos: number,
  suggestion: Suggestion,
): { text: string; cursorPos: number } {
  const beforeCursor = text.slice(0, cursorPos);
  const match = beforeCursor.match(/[\w一-鿿]+$/);
  if (!match) return { text, cursorPos };

  const wordStart = cursorPos - match[0].length;
  const newText = text.slice(0, wordStart) + suggestion.insertText + text.slice(cursorPos);
  return { text: newText, cursorPos: wordStart + suggestion.insertText.length };
}
