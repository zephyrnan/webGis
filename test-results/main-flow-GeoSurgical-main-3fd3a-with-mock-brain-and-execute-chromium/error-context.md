# Instructions

- Following Playwright test failed.
- Explain why, be concise, respect Playwright best practices.
- Provide a snippet of code with the fix, if possible.

# Test info

- Name: main-flow.spec.ts >> GeoSurgical main flow >> generate AST with mock brain and execute
- Location: e2e\main-flow.spec.ts:29:3

# Error details

```
Error: expect(locator).toBeVisible() failed

Locator: getByText(/GeoSurgical AST/)
Expected: visible
Timeout: 10000ms
Error: element(s) not found

Call log:
  - Expect "toBeVisible" with timeout 10000ms
  - waiting for getByText(/GeoSurgical AST/)

```

```yaml
- main:
  - heading "Language-driven operating table for spatial data" [level=1]
  - paragraph: "The MVP isolates the file lifecycle inside a Worker: React only handles UI and orchestration, without unpacking files, parsing GIS binaries, or sending real coordinates to the Brain."
  - text: Real WASM
  - button "中文"
  - button "English"
  - complementary:
    - text: Drop GIS files here Supports .geojson / .json / .zip / .shp. The main thread only receives the file and transfers it to the Worker.
    - heading "test-data.geojson" [level=2]
    - paragraph: geojson · 804 B
    - paragraph: Feature estimate
    - paragraph: "3"
    - paragraph: CRS
    - paragraph: EPSG:4326
    - paragraph: Encoding
    - paragraph: UTF-8
    - paragraph: BBox
    - paragraph: 113.91000, 22.45000, 113.96000, 22.50000
    - text: Field summary 3/3 id string
    - paragraph: "sample: A-001, B-002, C-003"
    - text: name string
    - paragraph: "sample: Block A, , Block C"
    - text: area number
    - paragraph: "sample: 120, 0, 500"
  - text: LLM_CALL_FAILED
  - paragraph: LLM call failed. Check Ollama service or API configuration.
  - paragraph: "Suggestion: 请检查本地 Ollama 服务是否运行，或尝试使用 Mock 模式。"
  - button "Convert to GCJ-02"
  - button "Remove zero-area features"
  - button "Remove empty names"
  - heading "Describe the spatial operation in natural language" [level=2]
  - 'textbox "Example: Remove features where name is empty, then export GeoJSON."': 删除 name 字段为空的要素，然后导出 GeoJSON
  - button "Generate AST"
  - button "Run operation" [disabled]
  - text: The auditable JSON instruction will appear after AST generation.
  - heading "Execution heartbeat" [level=2]
  - text: The Worker has taken ownership of the file buffer and started metadata triage. metadata Metadata Dry Run completed. metadata
  - heading "Result review" [level=2]
  - button "WebGL"
  - button "+"
  - button "–"
  - list:
    - listitem:
      - text: ©
      - link "OpenStreetMap":
        - /url: https://www.openstreetmap.org/copyright
      - text: contributors.
  - text: Result summary and download entry will appear after execution.
```

# Test source

```ts
  1  | import { test, expect } from '@playwright/test';
  2  | import { fileURLToPath } from 'url';
  3  | import path from 'path';
  4  | 
  5  | const __filename = fileURLToPath(import.meta.url);
  6  | const __dirname = path.dirname(__filename);
  7  | 
  8  | test.describe('GeoSurgical main flow', () => {
  9  |   test('page loads with title and dropzone', async ({ page }) => {
  10 |     await page.goto('/');
  11 |     await expect(page.locator('h1')).toBeVisible();
  12 |     await expect(page.getByText(/拖拽|Drop GIS/)).toBeVisible();
  13 |   });
  14 | 
  15 |   test('upload GeoJSON and see metadata', async ({ page }) => {
  16 |     await page.goto('/');
  17 | 
  18 |     const fileInput = page.locator('input[type="file"]');
  19 |     await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
  20 | 
  21 |     // Wait for metadata to appear
  22 |     await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });
  23 |     // Should show field summary
  24 |     await expect(page.getByText(/字段摘要|Field summary/)).toBeVisible();
  25 |     // Should show fields like id, name, area
  26 |     await expect(page.getByText('area', { exact: true })).toBeVisible();
  27 |   });
  28 | 
  29 |   test('generate AST with mock brain and execute', async ({ page }) => {
  30 |     await page.goto('/');
  31 | 
  32 |     // Upload file
  33 |     const fileInput = page.locator('input[type="file"]');
  34 |     await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
  35 |     await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });
  36 | 
  37 |     // Type a command that mock brain understands
  38 |     const textarea = page.locator('textarea');
  39 |     await textarea.fill('删除 name 字段为空的要素，然后导出 GeoJSON');
  40 | 
  41 |     // Click generate AST
  42 |     await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
  43 | 
  44 |     // Wait for AST preview to appear
> 45 |     await expect(page.getByText(/GeoSurgical AST/)).toBeVisible({ timeout: 10_000 });
     |                                                     ^ Error: expect(locator).toBeVisible() failed
  46 |     await expect(page.getByText('drop_empty')).toBeVisible();
  47 | 
  48 |     // Click execute
  49 |     await page.getByRole('button', { name: /确认执行|Run operation/ }).click();
  50 | 
  51 |     // Wait for result panel to show output features
  52 |     await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  53 |   });
  54 | 
  55 |   test('engine status indicator is visible', async ({ page }) => {
  56 |     await page.goto('/');
  57 | 
  58 |     // Should show engine status (mock or real)
  59 |     await expect(page.getByText(/Mock Mode|Real WASM|引擎加载中|Loading engine/)).toBeVisible({ timeout: 10_000 });
  60 |   });
  61 | 
  62 |   test('language switch works', async ({ page }) => {
  63 |     await page.goto('/');
  64 | 
  65 |     // Switch to English
  66 |     await page.getByRole('button', { name: 'English' }).click();
  67 |     await expect(page.getByText(/Language-driven|operating table/)).toBeVisible();
  68 | 
  69 |     // Switch back to Chinese
  70 |     await page.getByRole('button', { name: '中文' }).click();
  71 |     await expect(page.getByText(/语言驱动|手术台/)).toBeVisible();
  72 |   });
  73 | });
  74 | 
```