import { test, expect } from '@playwright/test';
import { fileURLToPath } from 'url';
import path from 'path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

test.describe('GeoSurgical main flow', () => {
  test('page loads with title and dropzone', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.getByText(/拖拽|Drop GIS/)).toBeVisible();
  });

  test('upload GeoJSON and see metadata', async ({ page }) => {
    await page.goto('/');

    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));

    // Wait for metadata to appear
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });
    // Should show field summary
    await expect(page.getByText(/字段摘要|Field summary/)).toBeVisible();
    // Should show fields like id, name, area
    await expect(page.getByText('area', { exact: true })).toBeVisible();
  });

  test('generate AST with mock brain and execute', async ({ page }) => {
    await page.goto('/');

    // Upload file
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    // Type a command that mock brain understands
    const textarea = page.locator('textarea');
    await textarea.fill('删除 name 字段为空的要素，然后导出 GeoJSON');

    // Click generate AST
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();

    // Wait for AST preview to appear
    await expect(page.getByText(/GeoSurgical AST/)).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('drop_empty')).toBeVisible();

    // Click execute
    await page.getByRole('button', { name: /确认执行|Run operation/ }).click();

    // Wait for result panel to show output features
    await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  });

  test('engine status indicator is visible', async ({ page }) => {
    await page.goto('/');

    // Should show engine status (mock or real)
    await expect(page.getByText(/Mock Mode|Real WASM|引擎加载中|Loading engine/)).toBeVisible({ timeout: 10_000 });
  });

  test('language switch works', async ({ page }) => {
    await page.goto('/');

    // Switch to English
    await page.getByRole('button', { name: 'English' }).click();
    await expect(page.getByText(/Language-driven|operating table/)).toBeVisible();

    // Switch back to Chinese
    await page.getByRole('button', { name: '中文' }).click();
    await expect(page.getByText(/语言驱动|手术台/)).toBeVisible();
  });

  test('simplify geometry via mock brain', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator('textarea');
    await textarea.fill('简化几何，容差 0.001');
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
    await expect(page.getByText('simplify')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /确认执行|Run operation/ }).click();
    await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  });

  test('validate geometry via mock brain', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator('textarea');
    await textarea.fill('检查并修复几何');
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
    await expect(page.getByText('validate_geometry')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /确认执行|Run operation/ }).click();
    await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  });

  test('transform_crs to GCJ-02 via mock brain', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator('textarea');
    await textarea.fill('转换为火星坐标');
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
    await expect(page.getByText('transform_crs')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /确认执行|Run operation/ }).click();
    await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  });

  test('transform_crs to EPSG:3857 via mock brain', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator('textarea');
    await textarea.fill('投影到 Web Mercator');
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
    await expect(page.getByText('transform_crs')).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText('EPSG:3857')).toBeVisible();

    await page.getByRole('button', { name: /确认执行|Run operation/ }).click();
    await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  });

  test('field_calculate density via mock brain', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator('textarea');
    await textarea.fill('计算密度');
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
    await expect(page.getByText('field_calculate')).toBeVisible({ timeout: 10_000 });

    await page.getByRole('button', { name: /确认执行|Run operation/ }).click();
    await expect(page.getByText(/输出要素|Output features/)).toBeVisible({ timeout: 15_000 });
  });

  test('fix_encoding generates AST via mock brain', async ({ page }) => {
    await page.goto('/');
    const fileInput = page.locator('input[type="file"]');
    await fileInput.setInputFiles(path.join(__dirname, 'test-data.geojson'));
    await expect(page.getByText('test-data.geojson')).toBeVisible({ timeout: 10_000 });

    const textarea = page.locator('textarea');
    await textarea.fill('修复乱码，GBK 转 UTF-8');
    await page.getByRole('button', { name: /生成 AST|Generate AST/ }).click();
    await expect(page.getByText('fix_encoding')).toBeVisible({ timeout: 10_000 });
  });
});
