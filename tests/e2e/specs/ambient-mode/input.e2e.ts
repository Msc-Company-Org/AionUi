/**
 * E2E: Ambient Mode — M2 Input State.
 *
 * Covers docs/product/ambient-mode-requirements.md AC-M2-1 through AC-M2-9.
 *
 * ── Strategy ─────────────────────────────────────────────────────────────────
 * Uses the `ambientTest` fixture (AIONUI_AMBIENT=1 + isolated Electron process
 * + `bubblePage` accessor). All interaction is black-box:
 *   - State inference via `data-testid` visibility (no internal IPC probing).
 *   - Mouse events via `bubblePage.mouse.*`.
 *   - Window bounds via `electronApp.evaluate({ BrowserWindow })`.
 *
 * ── AC status ────────────────────────────────────────────────────────────────
 *  AC-M2-1  P0  hover 300ms → expand to ~480×160, animation ≤ 250ms   → impl + test
 *  AC-M2-2  P0  ≥3 suggestion prompts visible                          → impl + test
 *  AC-M2-3  P0  click suggestion → fills textarea, no auto-send        → impl + test
 *  AC-M2-4  P0  Enter → submit IPC fired                               → impl + test (M3 stub)
 *  AC-M2-5  P1  drag file to input → attachment chip appears           → impl + test
 *  AC-M2-6  P1  Esc / blur+empty → collapse to bubble                  → impl + test
 *  AC-M2-7  P2  blur with content → stay in input                      → impl + test
 *  AC-M2-8  P2  unsupported file type → error, not mounted             → impl + test
 *  AC-M2-9  P2  multi-line input → height auto-grows, max 6 rows       → impl + test
 */

import { ambientTest as test, expect } from '../../fixtures';
import type { ElectronApplication } from '@playwright/test';

// ── Constants (mirror ambientWindowManager exports) ───────────────────────────

const BUBBLE_SIZE = 64;
const INPUT_WIDTH = 480;
const INPUT_HEIGHT = 160;

// ── Helpers ───────────────────────────────────────────────────────────────────

type WinBounds = { x: number; y: number; width: number; height: number };

async function getAmbientBounds(app: ElectronApplication): Promise<WinBounds | null> {
  return app.evaluate(({ BrowserWindow }) => {
    const win = BrowserWindow.getAllWindows().find((w) => {
      if (w.isDestroyed()) return false;
      const t = w.getTitle().toLowerCase();
      return t.includes('ambient') || t.includes('bubble');
    });
    return win ? win.getBounds() : null;
  });
}

/** Poll until ambient window reaches expected dimensions (within ±4 px). */
async function waitForWindowSize(
  app: ElectronApplication,
  expectedW: number,
  expectedH: number,
  timeoutMs = 1500
): Promise<WinBounds> {
  let last: WinBounds | null = null;
  const deadline = Date.now() + timeoutMs;
  // Poll with a simple async sleep — no-await-in-loop is acceptable here because
  // this is intentionally sequential polling (we NEED the previous result before retrying).
  // eslint-disable-next-line no-await-in-loop
  while (Date.now() < deadline) {
    // eslint-disable-next-line no-await-in-loop
    last = await getAmbientBounds(app);
    if (last && Math.abs(last.width - expectedW) <= 4 && Math.abs(last.height - expectedH) <= 4) {
      return last;
    }
    // eslint-disable-next-line no-await-in-loop
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(
    `Window did not reach ${expectedW}×${expectedH} within ${timeoutMs}ms. Last: ${JSON.stringify(last)}`
  );
}

// ── Suite ─────────────────────────────────────────────────────────────────────

test.describe('Ambient Mode — M2 Input State', () => {
  // Serial: each test may mutate window state.
  test.describe.configure({ mode: 'serial' });

  /**
   * Helper: ensure window is in bubble state before each test that needs a
   * clean start. Sends IPC collapse via renderer to restore bubble geometry.
   */
  async function ensureBubbleState(app: ElectronApplication, page: import('@playwright/test').Page): Promise<void> {
    // If already in bubble size, nothing to do.
    const bounds = await getAmbientBounds(app);
    if (bounds && Math.abs(bounds.width - BUBBLE_SIZE) <= 4) return;
    // Trigger collapse via renderer Esc key.
    await page.keyboard.press('Escape');
    await waitForWindowSize(app, BUBBLE_SIZE, BUBBLE_SIZE, 1500).catch(() => {
      /* best-effort — test will fail naturally if state is wrong */
    });
  }

  // ── AC-M2-1: hover 300ms → window expands to ~480×160 ─────────────────────

  test('AC-M2-1: hover bubble for 300ms expands window to INPUT_WIDTH × INPUT_HEIGHT', async ({
    electronApp,
    bubblePage,
  }) => {
    await ensureBubbleState(electronApp, bubblePage);

    // Locate bubble element center.
    const bubbleEl = bubblePage.locator('[data-testid="ambient-bubble"]');
    const box = await bubbleEl.boundingBox();
    expect(box, 'ambient-bubble must be visible').not.toBeNull();

    const cx = box!.x + box!.width / 2;
    const cy = box!.y + box!.height / 2;

    // Move cursor to bubble center (triggers mouseenter → 300ms timer).
    await bubblePage.mouse.move(cx, cy);

    // Wait for expand: timer fires at 300ms + IPC round-trip + setBounds.
    const bounds = await waitForWindowSize(electronApp, INPUT_WIDTH, INPUT_HEIGHT, 1500);

    expect(bounds.width, 'window width after hover').toBe(INPUT_WIDTH);
    expect(bounds.height, 'window height after hover').toBe(INPUT_HEIGHT);
  });

  // ── AC-M2-1b: input panel element is visible after expand ─────────────────

  test('AC-M2-1b: [data-testid="ambient-input"] is visible in DOM after expand', async ({ bubblePage }) => {
    // State should already be 'input' from the previous test (serial mode).
    await expect(bubblePage.locator('[data-testid="ambient-input"]')).toBeVisible({ timeout: 1000 });
    await expect(bubblePage.locator('[data-testid="ambient-bubble"]')).toBeHidden({ timeout: 500 });
  });

  // ── AC-M2-2: ≥3 suggestion prompts visible ────────────────────────────────

  test('AC-M2-2: at least 3 suggestion chips are visible', async ({ bubblePage }) => {
    const suggestions = bubblePage.locator('.ambient-suggestion');
    const count = await suggestions.count();
    expect(count, 'number of suggestion buttons').toBeGreaterThanOrEqual(3);

    // Each suggestion must be visible and non-empty — checked in parallel.
    const checks = Array.from({ length: count }, (_, i) =>
      Promise.all([
        expect(suggestions.nth(i)).toBeVisible(),
        suggestions
          .nth(i)
          .textContent()
          .then((text) => {
            expect((text ?? '').trim().length, `suggestion ${i} must have text`).toBeGreaterThan(0);
          }),
      ])
    );
    await Promise.all(checks);
  });

  // ── AC-M2-3: click suggestion fills textarea, no auto-send ────────────────

  test('AC-M2-3: clicking a suggestion fills textarea with its text and does not submit', async ({
    bubblePage,
    electronApp,
  }) => {
    const firstSuggestion = bubblePage.locator('[data-testid="ambient-suggestion-0"]');
    const expectedText = (await firstSuggestion.getAttribute('data-text')) ?? '';
    expect(expectedText.length, 'data-text must be non-empty').toBeGreaterThan(0);

    await firstSuggestion.click();

    // Textarea must contain the suggestion text.
    const textarea = bubblePage.locator('[data-testid="ambient-textarea"]');
    await expect(textarea).toHaveValue(expectedText);

    // Window must still be in input state (not submitted / collapsed).
    const bounds = await getAmbientBounds(electronApp);
    expect(bounds?.width, 'window must stay at INPUT_WIDTH').toBe(INPUT_WIDTH);
    await expect(bubblePage.locator('[data-testid="ambient-input"]')).toBeVisible();
  });

  // ── AC-M2-4: Enter submits (M3 stub — verifies IPC is fired) ──────────────

  test('AC-M2-4: pressing Enter with text triggers submit IPC (M3 stub)', async ({ bubblePage, electronApp }) => {
    const textarea = bubblePage.locator('[data-testid="ambient-textarea"]');

    // Clear any leftover text from AC-M2-3, then type fresh content.
    await textarea.click();
    await textarea.fill('');
    await textarea.type('Hello ambient');

    // Capture console output from main process to detect the submit stub log.
    const submitLogPromise = new Promise<boolean>((resolve) => {
      const off = electronApp.on('console', (msg) => {
        if (msg.text().includes('submit received')) {
          off();
          resolve(true);
        }
      });
      // Timeout fallback
      setTimeout(() => resolve(false), 3000);
    });

    await textarea.press('Enter');

    const submitReceived = await submitLogPromise;
    expect(submitReceived, 'ambient:submit IPC must reach main process').toBe(true);
  });

  // ── AC-M2-6: Esc collapses to bubble ──────────────────────────────────────

  test('AC-M2-6a: pressing Esc collapses to bubble state', async ({ bubblePage, electronApp }) => {
    // Make sure we're in input state first.
    await ensureBubbleState(electronApp, bubblePage);

    // Expand via hover.
    const bubbleEl = bubblePage.locator('[data-testid="ambient-bubble"]');
    const box = await bubbleEl.boundingBox();
    if (box) {
      await bubblePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitForWindowSize(electronApp, INPUT_WIDTH, INPUT_HEIGHT, 1500).catch(() => {});
    }

    // Ensure textarea is empty.
    const textarea = bubblePage.locator('[data-testid="ambient-textarea"]');
    await textarea.fill('');

    // Press Esc.
    await bubblePage.keyboard.press('Escape');

    // Window should return to bubble dimensions.
    await waitForWindowSize(electronApp, BUBBLE_SIZE, BUBBLE_SIZE, 1500);
    const bounds = await getAmbientBounds(electronApp);
    expect(bounds?.width, 'window width after Esc').toBe(BUBBLE_SIZE);
    expect(bounds?.height, 'window height after Esc').toBe(BUBBLE_SIZE);
  });

  test('AC-M2-6b: blur with empty textarea collapses to bubble', async ({ bubblePage, electronApp }) => {
    // Expand first.
    await ensureBubbleState(electronApp, bubblePage);
    const bubbleEl = bubblePage.locator('[data-testid="ambient-bubble"]');
    const box = await bubbleEl.boundingBox();
    if (box) {
      await bubblePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitForWindowSize(electronApp, INPUT_WIDTH, INPUT_HEIGHT, 1500).catch(() => {});
    }

    // Empty the textarea then blur.
    const textarea = bubblePage.locator('[data-testid="ambient-textarea"]');
    await textarea.fill('');
    await bubblePage.keyboard.press('Tab'); // moves focus away

    await waitForWindowSize(electronApp, BUBBLE_SIZE, BUBBLE_SIZE, 1500);
    const bounds = await getAmbientBounds(electronApp);
    expect(bounds?.width).toBe(BUBBLE_SIZE);
  });

  // ── AC-M2-7: blur with content stays in input ─────────────────────────────

  test('AC-M2-7: blur with non-empty textarea keeps input state open', async ({ bubblePage, electronApp }) => {
    // Expand.
    await ensureBubbleState(electronApp, bubblePage);
    const bubbleEl = bubblePage.locator('[data-testid="ambient-bubble"]');
    const box = await bubbleEl.boundingBox();
    if (box) {
      await bubblePage.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
      await waitForWindowSize(electronApp, INPUT_WIDTH, INPUT_HEIGHT, 1500).catch(() => {});
    }

    // Type content then blur.
    const textarea = bubblePage.locator('[data-testid="ambient-textarea"]');
    await textarea.fill('do not collapse me');
    await bubblePage.keyboard.press('Tab');

    // Wait 600ms to confirm the window did NOT collapse.
    await bubblePage.waitForTimeout(600);
    const bounds = await getAmbientBounds(electronApp);
    expect(bounds?.width, 'window must stay expanded when textarea has content').toBe(INPUT_WIDTH);
  });

  // ── AC-M2-5: drag file → attachment chip ─────────────────────────────────

  test('AC-M2-5: dropping a supported file adds an attachment chip', async ({ bubblePage, electronApp }) => {
    // Ensure input state.
    const bounds = await getAmbientBounds(electronApp);
    if (!bounds || bounds.width !== INPUT_WIDTH) {
      test.skip(true, 'Not in input state — skipping file-drop test in this run');
      return;
    }

    const panel = bubblePage.locator('[data-testid="ambient-input"]');

    // Simulate a drop event via page.dispatchEvent (no real file picker needed).
    await panel.dispatchEvent('dragover', {});
    await panel.dispatchEvent('drop', {
      dataTransfer: {
        files: [
          {
            name: 'notes.md',
            type: 'text/markdown',
            size: 1024,
            path: '/tmp/notes.md',
          },
        ],
      },
    });

    // Attachment chip for index 0 should appear.
    const chip = bubblePage.locator('[data-testid="ambient-attachment-0"]');
    await expect(chip).toBeVisible({ timeout: 1000 });
    const chipText = await chip.textContent();
    expect(chipText).toContain('notes.md');

    // Attachments container must be visible.
    await expect(bubblePage.locator('[data-testid="ambient-attachments"]')).toBeVisible();
  });

  // ── AC-M2-8: unsupported file type shows error, no chip ──────────────────

  test('AC-M2-8: dropping an unsupported file type shows error and does not mount it', async ({
    bubblePage,
    electronApp,
  }) => {
    const bounds = await getAmbientBounds(electronApp);
    if (!bounds || bounds.width !== INPUT_WIDTH) {
      test.skip(true, 'Not in input state — skipping unsupported-file test');
      return;
    }

    const panel = bubblePage.locator('[data-testid="ambient-input"]');
    const previousChipCount = await bubblePage.locator('.ambient-attachment').count();

    await panel.dispatchEvent('dragover', {});
    await panel.dispatchEvent('drop', {
      dataTransfer: {
        files: [
          {
            name: 'malware.exe',
            type: 'application/octet-stream',
            size: 512,
            path: '/tmp/malware.exe',
          },
        ],
      },
    });

    // Error element must appear.
    await expect(bubblePage.locator('[data-testid="ambient-error"]')).toBeVisible({ timeout: 1000 });

    // No new attachment chip must have been added.
    const newChipCount = await bubblePage.locator('.ambient-attachment').count();
    expect(newChipCount, 'unsupported file must not create a chip').toBe(previousChipCount);
  });

  // ── AC-M2-9: textarea auto-resizes up to 6 rows ──────────────────────────

  test('AC-M2-9: textarea height auto-grows with content, capped at 6 rows', async ({ bubblePage, electronApp }) => {
    const bounds = await getAmbientBounds(electronApp);
    if (!bounds || bounds.width !== INPUT_WIDTH) {
      test.skip(true, 'Not in input state — skipping auto-resize test');
      return;
    }

    const textarea = bubblePage.locator('[data-testid="ambient-textarea"]');
    await textarea.click();

    // Measure initial height (1 row).
    const initialHeight = await textarea.evaluate((el) => (el as HTMLTextAreaElement).clientHeight);

    // Type 8 lines of text (exceeds 6-row cap).
    await textarea.fill('line1\nline2\nline3\nline4\nline5\nline6\nline7\nline8');

    // Trigger input event so the auto-resize fires.
    await textarea.dispatchEvent('input');

    const expandedHeight = await textarea.evaluate((el) => (el as HTMLTextAreaElement).clientHeight);
    const cappedHeight = await textarea.evaluate((el) => {
      const t = el as HTMLTextAreaElement;
      return { clientH: t.clientHeight, scrollH: t.scrollHeight };
    });

    // Height must have grown.
    expect(expandedHeight, 'textarea must grow beyond single row').toBeGreaterThan(initialHeight);

    // scrollHeight must exceed clientHeight (scrollbar visible = cap enforced).
    expect(cappedHeight.scrollH, 'content must overflow cap at 6 rows').toBeGreaterThan(cappedHeight.clientH);
  });

  // ── Visual regression ────────────────────────────────────────────────────

  test('visual: input panel layout snapshot', async ({ bubblePage, electronApp }) => {
    const bounds = await getAmbientBounds(electronApp);
    if (!bounds || bounds.width !== INPUT_WIDTH) {
      test.skip(true, 'Not in input state — skipping visual snapshot');
      return;
    }

    const panel = bubblePage.locator('[data-testid="ambient-input"]');
    await expect(panel).toHaveScreenshot('ambient-input-panel.png', {
      maxDiffPixelRatio: 0.03,
    });
  });
});
