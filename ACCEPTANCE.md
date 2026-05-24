# Acceptance Criteria

## MVP Scope

- [x] Browser SPA can accept GIS files and keep heavy parsing off the React main thread.
- [x] Worker can hold uploaded file buffers and request metadata extraction from Rust WASM or Mock WASM.
- [x] Natural language commands can be translated into validated GeoSurgical AST operations.
- [x] Rust WASM dispatcher can execute core GeoJSON / ZIP Shapefile operations and return exportable results.
- [x] OpenLayers preview can render generated GeoJSON or lightweight large-dataset previews.
- [x] Result panel can expose download/copy actions without reserializing large WASM output when a Blob URL is available.

## Out of Scope

- Production hosting and deployment automation.
- Server-side storage or user accounts.
- Full GIS desktop parity.
- Guaranteed support for every Shapefile geometry/encoding edge case.
- Real LLM service availability beyond configurable local/API endpoints.

## Validation

- [x] Project dependencies are already installed locally.
- [x] Unit tests pass.
- [x] TypeScript typecheck passes.
- [x] ESLint passes.
- [x] Rust crate check passes.
- [x] Production build passes.
- [x] Manual browser verification of upload → metadata → command → result preview/download.
- [x] Security audit passes (0 vulnerabilities, official npm registry).

## Result

- Status: Passed
- Verified commands:
  - `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" test` — Passed, 3 files / 7 tests.
  - `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run typecheck` — Passed.
  - `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run lint` — Passed.
  - `cargo check --manifest-path "C:\Users\hhn\Desktop\frontend\React\webGis\src-wasm\Cargo.toml"` — Passed, 0 warnings.
  - `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run build` — Passed with non-blocking chunk-size warning.
  - `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" audit --registry https://registry.npmjs.org --audit-level=high` — Passed, 0 vulnerabilities.
  - Manual browser verification (2026-05-24) — Passed with issues found.
- Known Issues:
  - Vite reports a non-blocking main chunk size warning during production build.
  - Operation log "Mock WASM 已执行 filter_area (移除了 0 个要素)" contains hardcoded Chinese, not i18n'd.
- Notes:
  - BUG-007, BUG-008, and VALIDATION-011 were fixed during validation.
  - The code-level validation path now passes unit tests, TypeScript typecheck, ESLint, Rust check, and production build.
  - Manual browser verification confirmed: Real WASM loading, file upload, metadata extraction, shortcut tags, Mock Brain AST generation, AST execution, progress timeline, result panel, download link, and 6-language switching all work correctly.
