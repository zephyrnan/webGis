# Design Guidelines

## Product UI Goal

GeoSurgical is a spatial-data workbench. The interface should feel like a clean, focused developer console: precise and bright — where every pixel serves the workflow of uploading, inspecting, commanding, and exporting geospatial data.

## Style Direction

- Direction: Clean light dashboard with subtle depth.
- References: Linear (light), Vercel Dashboard (light), GitHub Light.
- Visual tone: white background, zinc-gray surfaces, dark text and accents. No decorative color — only functional state colors (emerald/amber/red).

## Design Principles

1. No global scroll. The viewport is `h-screen w-full overflow-hidden`. Only local panels scroll.
2. Three-column grid layout (`grid-cols-12`): data flow (3 cols), visualization (5 cols), control flow (4 cols).
3. Monochrome-first. Color is reserved for state signals: success (emerald), warning (amber), error (red), active (zinc border).
4. Compact density. Small text (10-12px), tight padding, minimal gaps. This is a power-user tool.
5. Monospace for data. File names, field names, AST, commands, and technical values use `font-mono`.

## Color Tokens

- App background: `#ffffff` (white)
- Panel surface: `zinc-50` (`#fafafa`)
- Nested surface: `zinc-100` (`#f4f4f5`)
- Borders: `zinc-200` (`#e4e4e7`), active `zinc-300` (`#d4d4d8`)
- Primary text: `zinc-900` (`#18181b`)
- Secondary text: `zinc-600` (`#52525b`)
- Muted text: `zinc-400` (`#a1a1aa`)
- Accent (primary action): `zinc-900` bg + `white` text (inverted button)
- Success: `emerald-500` / `emerald-700`
- Warning: `amber-500` / `amber-700`
- Error: `red-500` / `red-700`

## Typography

- Font: Inter (system sans-serif stack).
- Page title: `text-sm font-semibold` (compact header).
- Panel headings: `text-xs font-medium text-zinc-600`.
- Body/metadata: `text-[11px]` or `text-xs`.
- Monospace values: `font-mono text-[11px]`.
- Labels: `text-[10px] text-zinc-400 uppercase tracking-wider`.

## Layout

- Full viewport: `h-screen w-full flex flex-col overflow-hidden`.
- Header: `shrink-0`, compact (py-2.5), border-bottom only.
- Main: `flex-1 min-h-0 grid grid-cols-12 gap-px bg-zinc-200`.
- Left (col-span-3): file upload + layer tree + batch. Layer tree scrolls locally.
- Center (col-span-5): map canvas fills remaining space (`flex-1 min-h-0`).
- Right (col-span-4): command palette (shrink-0) + AST/progress (scrollable) + history/result (max-h-45vh scrollable).
- Gap: `gap-px` with `bg-zinc-200` creates subtle 1px dividers.
- No rounded-3xl. Use `rounded-lg` or `rounded-md` for cards.

## Components

- Buttons: `rounded-md`, compact padding. Primary = zinc-900 bg + white text. Secondary = zinc-300 border + zinc-600 text.
- Inputs: `bg-white border-zinc-300`, monospace, `focus:border-zinc-400`.
- Cards: `rounded-lg border border-zinc-200 bg-zinc-50 p-3`.
- Tables: compact rows (32px), sticky header, virtualized for large datasets.
- Map: fills center column, light OL controls override.
- Progress: thin 1px bar, zinc-900 fill on zinc-200 track.
- Error callouts: `border-amber-300 bg-amber-50 text-amber-700`.
- Layer tree: tree indentation with `border-l border-zinc-200 ml-5 pl-3`.

## Interaction States

- Hover: darken border/text, no layout shift.
- Focus: `border-zinc-400` for inputs, no colored rings.
- Accessibility: every icon-only control must have an accessible label; toggles expose `aria-pressed`; disclosures expose `aria-expanded`; sortable tables use real buttons and `aria-sort`.
- Loading: spinner or progress bar, controls stay visible but disabled.
- Error: inline callout with amber border, not toast-only.
- Disabled: `opacity-40` or `text-zinc-300`.

## Do / Don't

### Do

- Keep the layout locked to viewport height.
- Use monospace for all technical/data values.
- Show WASM/mock mode badge in header.
- Show AST as auditable JSON in a scrollable pre block.
- Use `overflow-y-auto` on specific panels, never on body.

### Don't

- Add global scrollbars.
- Use decorative gradients or rounded-3xl cards.
- Use colored backgrounds for non-state elements.
- Add animations that distract from data inspection.
- Use dark theme surfaces (zinc-900/zinc-950).
