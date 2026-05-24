# GeoSurgical WebGIS

GeoSurgical is a language-driven spatial-data workbench. Users upload GIS files, inspect local metadata, describe cleanup or conversion work in natural language, review the generated GeoSurgical AST, execute it through a Worker-owned Rust WASM engine, preview the result on a map, and export the output.

## Features

- Upload `.geojson`, `.json`, and `.zip` Shapefile inputs.
- Transfer uploaded `ArrayBuffer` objects to a Web Worker so heavy parsing stays off the React main thread.
- Extract metadata through Rust WASM with TypeScript Mock fallback.
- Generate shortcut command tags from metadata, CRS, fields, layers, and warnings.
- Translate natural-language commands into validated GeoSurgical AST operations with either Mock Brain or a configurable LLM Brain.
- Validate AST operations with a TypeScript/Zod whitelist before Worker execution.
- Execute GIS operations in Rust WASM, including filtering, field cleanup, CRS transforms, encoding repair, simplify, field calculation, geometry validation, buffer, clip, intersect, dissolve, and export.
- Preview GeoJSON output with OpenLayers, WebGL/Canvas switching, feature popups, and attribute table support.
- Use lightweight convex-hull preview content for very large result sets.
- Download results using Blob URLs to avoid unnecessary large JSON reserialization.
- Multi-language UI support.

## Tech Stack

- Vite + React + TypeScript
- Tailwind CSS
- OpenLayers
- Web Worker API + Transferable Objects
- Rust + wasm-bindgen + `geo`, `geojson`, `shapefile`, `zip`, `encoding_rs`
- Zod
- Vitest and Playwright scripts

## Architecture

```text
React UI thread
  Dropzone / Metadata / Command Palette / AST Preview / Map / Result Panel
        |
        | Transferable ArrayBuffer + AST messages
        v
Web Worker
  task context owns uploaded buffers
        |
        v
Rust WASM engine
  extract metadata -> execute GeoSurgical AST -> return envelope + payload
```

Core constraints:

- The React main thread must not unzip or parse heavy GIS binary files.
- The Worker owns the uploaded file buffer after transfer.
- LLM Brain receives metadata summaries and user commands, not full geometry payloads.
- Operations must be represented as auditable JSON AST before execution.

## Getting Started

### Prerequisites

- Node.js with npm
- Rust toolchain with Cargo
- Optional: `wasm-pack` when rebuilding `src-wasm/pkg`
- Optional: local Ollama or an OpenAI-compatible endpoint for real LLM Brain mode

### Install

```bash
npm install
```

### Environment

Copy `.env.example` to `.env` if you want to configure LLM mode. `.env` and `.env.*` are ignored by Git except `.env.example`.

| Name | Required | Description |
| --- | --- | --- |
| `VITE_BRAIN_MODE` | No | `mock` or `llm`; controls Mock Brain vs configured LLM Brain. |
| `VITE_LLM_ENDPOINT` | No | LLM endpoint, for example local Ollama at `http://localhost:11434`. |
| `VITE_LLM_API_KEY` | No | API key for OpenAI-compatible providers; not needed for local Ollama. |
| `VITE_LLM_MODEL` | No | Model name used by the LLM Brain gateway. |

### Run

```bash
npm run dev
```

### Build

```bash
npm run build
```

### Run with Docker Desktop

Make sure Docker Desktop is running, then build and start the container:

```powershell
docker compose up --build
```

Open the app at `http://localhost:8080`.

Useful Docker commands:

```powershell
# Build the production image only
docker compose build

# Start in the background
docker compose up -d

# View logs
docker compose logs -f webgis

# Stop and remove the container
docker compose down
```

The default Docker build uses Mock Brain mode so the container can run without an LLM service. To build with LLM mode, set build-time variables before running Compose:

```powershell
$env:VITE_BRAIN_MODE="llm"
$env:VITE_LLM_ENDPOINT="http://localhost:11434"
$env:VITE_LLM_MODEL="qwen2.5:7b"
docker compose up --build
```

Vite `VITE_*` environment variables are injected at build time. If you change `.env` or shell environment values that affect the frontend build, rebuild the Docker image with `docker compose up --build`.

Do not put private API keys into frontend `VITE_*` values for production builds. Vite exposes these values to browser JavaScript.

### Rebuild Rust WASM

```bash
cd src-wasm
wasm-pack build --target web --release
```

## Scripts

| Command | Description |
| --- | --- |
| `npm run dev` | Start the Vite development server. |
| `npm run build` | Run TypeScript project build and Vite production build. |
| `npm run preview` | Preview the production build. |
| `npm test` | Run Vitest unit tests. |
| `npm run test:watch` | Run Vitest in watch mode. |
| `npm run test:e2e` | Run Playwright tests. |
| `npm run typecheck` | Run TypeScript project checks. |
| `npm run lint` | Run ESLint. |
| `cargo check --manifest-path src-wasm/Cargo.toml` | Check the Rust WASM crate. |
| `docker compose up --build` | Build and run the production static app in Docker Desktop on port 8080. |
| `docker compose down` | Stop and remove the local Docker container. |

## Supported AST Operations

| Action | Purpose |
| --- | --- |
| `filter_area` | Filter features by numeric field/operator/value. |
| `drop_empty` | Remove features with empty field values. |
| `rename_field` | Rename an attribute field. |
| `transform_crs` | Transform supported CRS pairs such as WGS84/GCJ-02/Web Mercator. |
| `fix_encoding` | Re-decode DBF text with a selected source encoding. |
| `simplify` | Simplify supported geometries by tolerance. |
| `field_calculate` | Calculate a target field from numeric operands. |
| `validate_geometry` | Check or repair simple invalid geometry cases. |
| `buffer` | Create approximate buffer geometry. |
| `clip` | Keep features intersecting a bounding box. |
| `intersect` | Keep features intersecting a bounding box. |
| `dissolve` | Merge polygon features by field value. |
| `export` | Export the result. |
| `noop` / `need_clarification` | Represent unsupported or ambiguous planning output. |

## Validation

Latest validation status is tracked in `ACCEPTANCE.md`.

Verified on 2026-05-20:

- `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" test` — passed, 7 tests.
- `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run typecheck` — passed.
- `cargo check --manifest-path "C:\Users\hhn\Desktop\frontend\React\webGis\src-wasm\Cargo.toml"` — passed with non-blocking warnings.
- `npm --prefix "C:\Users\hhn\Desktop\frontend\React\webGis" run build` — passed with a non-blocking chunk-size warning.

Manual browser verification is still recommended for representative GeoJSON and ZIP Shapefile samples before production use.

## Project Documents

- `产品蓝图.md` — architecture and product blueprint.
- `DESIGN.md` — UI direction and component rules.
- `ACCEPTANCE.md` — MVP scope and validation status.
- `BUGS.md` — bug history, validation findings, and resolutions.

## Deployment

No remote production deployment target is configured in this repository. Build with `npm run build` and serve the generated `dist` directory from a static host that supports Worker modules and WASM assets.

For local containerized preview, Docker Desktop can build the Vite app and serve `dist` with Nginx using the included `Dockerfile`, `nginx.conf`, and `docker-compose.yml`.

## Known Limitations

- Large ZIP Shapefile workflows should be verified with representative files before production use.
- Real LLM mode depends on a reachable endpoint and model behavior.
- `npm audit` may fail when npm is configured to a registry mirror that does not implement npm security audit endpoints.
- Current production build emits a non-blocking chunk-size warning for the main JavaScript bundle.
- Rust `cargo check` currently reports non-blocking warnings in `dispatcher.rs` and `metadata.rs`.

See `BUGS.md` for detailed issue history and current validation notes.
