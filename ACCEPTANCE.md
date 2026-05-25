# Acceptance Criteria

## MVP Scope

- [x] Browser SPA can accept GIS files and keep heavy parsing off the React main thread.
- [x] Worker can hold uploaded file buffers and request metadata extraction from Rust WASM or Mock WASM.
- [x] Natural language commands can be translated into validated GeoSurgical AST operations.
- [x] Rust WASM dispatcher can execute core GeoJSON / ZIP Shapefile operations and return exportable results.
- [x] OpenLayers preview can render generated GeoJSON or lightweight large-dataset previews.
- [x] Result panel can expose download/copy actions without reserializing large WASM output when a Blob URL is available.

## Phase D Features

- [x] Task history with IndexedDB persistence — restore, delete, replay past sessions.
- [x] AST pipeline templates — save, load, export, import reusable operation chains.
- [x] Batch processing — apply same AST to multiple files with per-file progress.
- [x] Multi-format export — GeoJSON and CSV.
- [x] Data quality report — feature delta, encoding fixes, geometry issues, warnings.
- [x] AST schema type generation — `npm run generate:types` from `schemas/ast-schema.json`.

## Out of Scope

- Production hosting and deployment automation.
- Server-side storage or user accounts.
- Full GIS desktop parity.
- Guaranteed support for every Shapefile geometry/encoding edge case.
- Real LLM service availability beyond configurable local/API endpoints.

## Validation

- [x] Project dependencies are already installed locally.
- [x] Unit tests pass — 45 tests across 3 files.
- [x] TypeScript typecheck passes.
- [x] Rust crate check passes — 0 warnings.
- [x] Production build passes — no chunk-size warning.
- [x] `npm run generate:types` passes.
- [x] Security audit passes (0 vulnerabilities, official npm registry).
- [x] Manual browser verification of upload → metadata → command → result preview/download.
- [x] 6-language UI switching verified (zh, en, ja, ko, fr, es).

## Result

- Status: Passed
- Verified commands:
  - `npm test` — Passed, 3 files / 45 tests.
  - `npm run typecheck` — Passed.
  - `npm run generate:types` — Passed.
  - `cargo check --manifest-path src-wasm/Cargo.toml` — Passed, 0 warnings.
  - `npm run build` — Passed, no chunk-size warning.
  - `npm audit --registry https://registry.npmjs.org` — Passed, 0 vulnerabilities.
- Manual browser verification (2026-05-25):
  - [x] Page loads correctly with Real WASM indicator.
  - [x] 6-language switching: zh, en, ja, ko, fr, es all render correctly.
  - [x] GeoJSON upload → metadata extraction (features, CRS, encoding, bbox, fields).
  - [x] Shortcut tags generated from metadata.
  - [x] Progress timeline shows metadata events.
  - [x] Mock Brain command parsing verified via 45 unit tests.
  - [x] Error callout displays LLM errors with recovery suggestions.
- Known Issues:
  - LLM Brain depends on external API availability (quota, network). Use Mock Brain or local Ollama for reliable operation.
  - Operation log "Mock WASM 已执行 filter_area (移除了 0 个要素)" contains hardcoded Chinese (BUG-013).
- Notes:
  - All P0 and P1 ROADMAP items completed.
  - All P2 ROADMAP items completed (history, templates, batch, export, quality report).
  - P3.1 (LLM security), P3.2 (deployment), P3.3 partial (TS type generation) completed.
