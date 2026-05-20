# Design Guidelines

## Product UI Goal

GeoSurgical should feel like a focused spatial-data workbench: upload a file, describe the operation in natural language, inspect the generated plan, preview the result, and export with confidence.

## Style Direction

- Direction: dense professional geospatial console with language-first workflow.
- References: Linear-style command focus, Vercel-style dark technical surfaces, OpenLayers-style map-first validation.
- Visual tone: dark, precise, high-contrast, cyan/emerald accents for active/healthy states, amber/red for warnings and failures.

## Design Principles

1. Keep the command path central: file context, command input, AST preview, progress, map, and result should stay visible together on wide screens.
2. Prefer compact cards over modal-heavy flows so users can inspect spatial metadata and execution state at once.
3. Distinguish engine states clearly: real WASM, mock fallback, loading, warnings, and execution failures must be visible.
4. Make large-data handling explicit: previews, Blob URL downloads, WebGL toggles, and unavailable undo states should be understandable.
5. Use natural-language affordances, but always show auditable AST and operation logs before/after execution.

## Color Tokens

- App background: `slate-950`
- Panel background: `slate-900/70`, deeper nested surfaces `slate-950/70`
- Primary accent: `cyan-400` / `cyan-300`
- Success accent: `emerald-400` / `emerald-300`
- Warning accent: `amber-400` / `amber-200`
- Error accent: `rose-400` / `red-300`
- Borders: `slate-800`, active borders `cyan-400/40`
- Primary text: `white`, secondary text `slate-300`, muted text `slate-500`

## Typography

- Use the project default sans-serif stack.
- Page title: large, bold, tight tracking.
- Panel headings: semibold, compact.
- Metadata, logs, helper text: small text with strong contrast hierarchy.
- Code/AST content: monospace where appropriate, never decorative.

## Layout

- Maximum content width: approximately `1600px`.
- Desktop layout: three-column grid for upload/metadata, command/AST/progress, map/result.
- Tablet/mobile: stack cards vertically with command flow before preview/result.
- Spacing: card gaps around `1.5rem`; internal card padding around `1.25rem`.
- Rounded corners: large rounded cards (`rounded-3xl`) to soften dense technical UI.

## Components

- Buttons: pill-shaped, clear disabled state, primary cyan for execution/download.
- Inputs: dark surface, visible focus border, no hidden validation feedback.
- Cards: bordered dark panels with subtle transparency.
- Tables: compact rows, sticky context where useful, avoid visual noise.
- Map: keep controls minimal; WebGL/Canvas and comparison toggles stay near map title.
- Progress: timeline messages should be short and readable, with percent where useful.
- Error callouts: structured code/message/suggestion, never only raw stack traces.

## Interaction States

- Hover: lighten border/text, avoid layout shift.
- Focus: cyan border/ring for keyboard discoverability.
- Loading: show progress or engine loading badge, not silent disabled controls.
- Error: keep the failed context visible and suggest recovery when possible.
- Disabled: lower contrast but keep label readable.

## Do / Don't

### Do

- Keep WASM/mock mode visible.
- Show AST and operation logs as auditable artifacts.
- Use preview hulls or summaries for large datasets.
- Keep i18n-compatible UI copy.

### Don't

- Add complex GIS form panels that compete with the command palette.
- Parse large binary files on the React main thread.
- Hide failed operations behind generic toast-only feedback.
- Add decorative animations that slow down large-file workflows.
