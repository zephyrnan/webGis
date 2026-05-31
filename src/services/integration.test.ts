import { describe, expect, it, beforeEach } from 'vitest';
import 'fake-indexeddb/auto';
import { MockBrainGateway } from './brain';
import { validateAst } from './astValidation';
import type { GeoSurgicalMetadata } from '../types/metadata';
import type { GeoSurgicalAst } from '../types/ast';
import {
  saveSession,
  loadSessions,
  deleteSession,
  clearSessions,
  type PersistedSession,
} from './history';
import {
  saveTemplate,
  loadTemplates,
  deleteTemplate,
  exportTemplates,
  importTemplates,
  type AstTemplate,
} from './templates';

// ─── shared test fixtures ────────────────────────────────────────

const metadata: GeoSurgicalMetadata = {
  fileType: 'geojson',
  fileName: 'test.geojson',
  fileSize: 1024,
  featureCountEstimate: 100,
  fields: [
    { name: 'id', type: 'number' },
    { name: 'name', type: 'string' },
    { name: 'area', type: 'number' },
    { name: 'type', type: 'string' },
    { name: 'population', type: 'number' },
  ],
  bbox: [100, 30, 120, 40],
  crs: 'EPSG:4326',
  encoding: 'UTF-8',
  fieldPolicy: { totalFieldCount: 5, includedFieldCount: 5, truncated: false },
  warnings: [],
};

const metadataMultiLayer: GeoSurgicalMetadata = {
  ...metadata,
  layers: [
    { name: 'roads', featureCount: 500, fields: metadata.fields, bbox: null, crs: null, encoding: null },
    { name: 'buildings', featureCount: 2000, fields: metadata.fields, bbox: null, crs: null, encoding: null },
  ],
};

function makeSession(overrides: Partial<PersistedSession> = {}): PersistedSession {
  return {
    id: `session-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    fileName: 'test.geojson',
    command: '删除 name 为空的要素',
    ast: {
      version: '1.0',
      operations: [
        { action: 'drop_empty', field: 'name' },
        { action: 'export', format: 'geojson' },
      ],
    },
    resultSnapshot: {
      kind: 'geojson',
      fileName: 'test.geosurgical.geojson',
      summary: { inputFeatureCount: 100, outputFeatureCount: 80, operations: ['drop_empty', 'export'], mockMode: true },
      logs: ['operation:drop_empty|removed=20'],
      warnings: [],
    },
    timestamp: Date.now(),
    ...overrides,
  };
}

function makeTemplate(overrides: Partial<AstTemplate> = {}): AstTemplate {
  return {
    id: `tpl-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name: 'Clean & Export',
    command: '删除 name 为空的要素',
    ast: {
      version: '1.0',
      operations: [
        { action: 'drop_empty', field: 'name' },
        { action: 'export', format: 'geojson' },
      ],
    },
    createdAt: Date.now(),
    ...overrides,
  };
}

// ─── 1. Brain → AST Validation pipeline ─────────────────────────

describe('Brain → Validation pipeline', () => {
  const brain = new MockBrainGateway();

  it('drop_empty command passes validation', async () => {
    const ast = await brain.plan({
      command: '删除 name 为空的要素，然后导出 GeoJSON',
      metadata,
      schemaVersion: '1.0',
    });
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.operations).toHaveLength(2);
      expect(result.risks.length).toBeGreaterThan(0); // drop_empty is a risk
    }
  });

  it('filter_area command passes validation', async () => {
    const ast = await brain.plan({
      command: '清理 area 为 0 的废弃多边形',
      metadata,
      schemaVersion: '1.0',
    });
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.operations.some(op => op.action === 'filter_area')).toBe(true);
    }
  });

  it('transform_crs command passes and has transform risk', async () => {
    const ast = await brain.plan({
      command: '转换为火星坐标',
      metadata,
      schemaVersion: '1.0',
    });
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.risks).toContain('ast.riskTransform');
    }
  });

  it('simplify command passes and has simplify risk', async () => {
    const ast = await brain.plan({
      command: '简化几何，容差 0.001',
      metadata,
      schemaVersion: '1.0',
    });
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.risks).toContain('ast.riskSimplify');
    }
  });

  it('fix_encoding command passes validation', async () => {
    const ast = await brain.plan({
      command: '修复乱码，GBK 转 UTF-8',
      metadata,
      schemaVersion: '1.0',
    });
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
  });

  it('export only command passes validation', async () => {
    const ast = await brain.plan({
      command: '导出 CSV',
      metadata,
      schemaVersion: '1.0',
    });
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.ast.operations.some(op => op.action === 'export')).toBe(true);
    }
  });
});

// ─── 2. AST Validation edge cases ───────────────────────────────

describe('AST Validation edge cases', () => {
  it('rejects AST with field not in metadata', () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [
        { action: 'drop_empty', field: 'nonexistent_field' },
        { action: 'export', format: 'geojson' },
      ],
    };
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('FIELD_NOT_IN_METADATA');
    }
  });

  it('rejects rename_field with missing source field', () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [
        { action: 'rename_field', from: 'ghost', to: 'new_name' },
      ],
    };
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(false);
  });

  it('accepts rename_field with valid source field', () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [
        { action: 'rename_field', from: 'name', to: 'label' },
        { action: 'export', format: 'geojson' },
      ],
    };
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
  });

  it('rejects invalid target_layer', () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [{ action: 'export', format: 'geojson' }],
      target_layer: 'nonexistent_layer',
    };
    const result = validateAst(ast, metadataMultiLayer);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.code).toBe('LAYER_NOT_FOUND');
    }
  });

  it('accepts valid target_layer', () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [{ action: 'export', format: 'geojson' }],
      target_layer: 'roads',
    };
    const result = validateAst(ast, metadataMultiLayer);
    expect(result.ok).toBe(true);
  });

  it('rejects malformed AST', () => {
    const result = validateAst({ version: '1.0', operations: 'not an array' }, metadata);
    expect(result.ok).toBe(false);
  });

  it('detects multiple risks in multi-op pipeline', () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [
        { action: 'drop_empty', field: 'name' },
        { action: 'transform_crs', from: 'EPSG:4326', to: 'GCJ-02' },
        { action: 'simplify', tolerance: 0.001 },
        { action: 'export', format: 'geojson' },
      ],
    };
    const result = validateAst(ast, metadata);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.risks).toContain('ast.risk');           // drop_empty
      expect(result.risks).toContain('ast.riskTransform');  // transform_crs
      expect(result.risks).toContain('ast.riskSimplify');    // simplify
    }
  });
});

// ─── 3. Template export / import round-trip ─────────────────────

describe('Template export/import', () => {
  it('round-trips templates through JSON', () => {
    const templates: AstTemplate[] = [
      makeTemplate({ id: 'tpl-1', name: 'Clean', command: '删除空值' }),
      makeTemplate({ id: 'tpl-2', name: 'Simplify', command: '简化几何' }),
    ];

    const json = exportTemplates(templates);
    const imported = importTemplates(json);

    expect(imported).toHaveLength(2);
    expect(imported[0].id).toBe('tpl-1');
    expect(imported[0].name).toBe('Clean');
    expect(imported[1].id).toBe('tpl-2');
    expect(imported[1].ast.operations).toEqual(templates[1].ast.operations);
  });

  it('import fills defaults for missing fields', () => {
    const json = JSON.stringify([{ ast: { version: '1.0', operations: [] } }]);
    const imported = importTemplates(json);
    expect(imported).toHaveLength(1);
    expect(imported[0].name).toBe('Imported');
    expect(imported[0].command).toBe('');
    expect(imported[0].id).toBeTruthy(); // auto-generated UUID
  });

  it('import rejects non-array JSON', () => {
    expect(() => importTemplates('{"not": "array"}')).toThrow('Expected a JSON array');
  });

  it('import rejects invalid JSON', () => {
    expect(() => importTemplates('not json')).toThrow();
  });

  it('export produces valid JSON', () => {
    const templates = [makeTemplate()];
    const json = exportTemplates(templates);
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

// ─── 4. IndexedDB History CRUD ──────────────────────────────────

describe('IndexedDB History', () => {
  beforeEach(async () => {
    await clearSessions();
  });

  it('saves and loads a session', async () => {
    const session = makeSession({ id: 'test-1', timestamp: 1000 });
    await saveSession(session);
    const loaded = await loadSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('test-1');
    expect(loaded[0].fileName).toBe('test.geojson');
  });

  it('loads sessions sorted by timestamp (newest first)', async () => {
    await saveSession(makeSession({ id: 'old', timestamp: 1000 }));
    await saveSession(makeSession({ id: 'new', timestamp: 3000 }));
    await saveSession(makeSession({ id: 'mid', timestamp: 2000 }));

    const loaded = await loadSessions();
    expect(loaded).toHaveLength(3);
    expect(loaded[0].id).toBe('new');
    expect(loaded[1].id).toBe('mid');
    expect(loaded[2].id).toBe('old');
  });

  it('respects limit parameter', async () => {
    for (let i = 0; i < 10; i++) {
      await saveSession(makeSession({ id: `s-${i}`, timestamp: i * 1000 }));
    }
    const loaded = await loadSessions(3);
    expect(loaded).toHaveLength(3);
  });

  it('deletes a specific session', async () => {
    await saveSession(makeSession({ id: 'keep', timestamp: 1000 }));
    await saveSession(makeSession({ id: 'remove', timestamp: 2000 }));

    await deleteSession('remove');

    const loaded = await loadSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('keep');
  });

  it('clears all sessions', async () => {
    await saveSession(makeSession({ id: 'a', timestamp: 1000 }));
    await saveSession(makeSession({ id: 'b', timestamp: 2000 }));

    await clearSessions();

    const loaded = await loadSessions();
    expect(loaded).toHaveLength(0);
  });

  it('overwrites session with same id', async () => {
    await saveSession(makeSession({ id: 'dup', command: 'first', timestamp: 1000 }));
    await saveSession(makeSession({ id: 'dup', command: 'second', timestamp: 2000 }));

    const loaded = await loadSessions();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].command).toBe('second');
  });

  it('preserves AST structure through save/load', async () => {
    const ast: GeoSurgicalAst = {
      version: '1.0',
      operations: [
        { action: 'filter_area', field: 'area', operator: '>', value: 0 },
        { action: 'rename_field', from: 'name', to: 'label' },
        { action: 'export', format: 'geojson' },
      ],
    };
    await saveSession(makeSession({ id: 'ast-test', ast, timestamp: 1000 }));

    const loaded = await loadSessions();
    expect(loaded[0].ast.operations).toHaveLength(3);
    expect(loaded[0].ast.operations[0].action).toBe('filter_area');
    expect(loaded[0].ast.operations[1].action).toBe('rename_field');
  });
});

// ─── 5. IndexedDB Templates CRUD ────────────────────────────────

describe('IndexedDB Templates', () => {
  beforeEach(async () => {
    // Clean up by loading and deleting all
    const all = await loadTemplates();
    for (const t of all) {
      await deleteTemplate(t.id);
    }
  });

  it('saves and loads a template', async () => {
    const tpl = makeTemplate({ id: 'tpl-save' });
    await saveTemplate(tpl);

    const loaded = await loadTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].name).toBe('Clean & Export');
  });

  it('deletes a template', async () => {
    await saveTemplate(makeTemplate({ id: 'tpl-1' }));
    await saveTemplate(makeTemplate({ id: 'tpl-2' }));

    await deleteTemplate('tpl-1');

    const loaded = await loadTemplates();
    expect(loaded).toHaveLength(1);
    expect(loaded[0].id).toBe('tpl-2');
  });

  it('export → import → save → load round-trip', async () => {
    const original = [
      makeTemplate({ id: 'rt-1', name: 'Pipeline A' }),
      makeTemplate({ id: 'rt-2', name: 'Pipeline B' }),
    ];

    // Export to JSON
    const json = exportTemplates(original);

    // Import from JSON
    const imported = importTemplates(json);
    expect(imported).toHaveLength(2);

    // Save imported to IndexedDB
    for (const t of imported) {
      await saveTemplate(t);
    }

    // Load from IndexedDB
    const loaded = await loadTemplates();
    expect(loaded).toHaveLength(2);

    const names = loaded.map(t => t.name).sort();
    expect(names).toEqual(['Pipeline A', 'Pipeline B']);
  });
});
