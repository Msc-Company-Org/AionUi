/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Pure geometry helpers for the Ambient window.
 *
 * Intentionally free of Electron imports so unit tests can run without mocking.
 * `ambientWindowManager.ts` re-exports the constants and delegates the math here.
 */

/** Ambient bubble size in logical pixels (both axes). */
export const BUBBLE_SIZE = 64;

/** Minimum distance between the bubble/panel and the workArea edge. */
export const SCREEN_MARGIN = 24;

/** Input panel dimensions (M2). */
export const INPUT_WIDTH = 480;
export const INPUT_HEIGHT = 160;

export type WorkArea = { x: number; y: number; width: number; height: number };
export type Bounds = { x: number; y: number; width: number; height: number };

/**
 * Compute the input panel bounds anchored to the bubble's current position.
 *
 * Alignment:
 *   - Right edge of input panel == right edge of bubble.
 *   - Bottom edge of input panel == bottom edge of bubble.
 *   - Result is clamped inside `workArea` with SCREEN_MARGIN on every side.
 *
 * Pure function — no Electron side-effects. Exported from
 * `ambientWindowManager.ts` for backward-compatibility with E2E helpers.
 */
export function computeInputBounds(bubbleX: number, bubbleY: number, workArea: WorkArea): Bounds {
  // Anchor right/bottom edges of the input panel to the bubble.
  let ix = bubbleX + BUBBLE_SIZE - INPUT_WIDTH;
  let iy = bubbleY + BUBBLE_SIZE - INPUT_HEIGHT;

  // Clamp left + top edges (hard minimum — always applied).
  const minX = workArea.x + SCREEN_MARGIN;
  const minY = workArea.y + SCREEN_MARGIN;
  ix = Math.max(minX, ix);
  iy = Math.max(minY, iy);

  // Clamp right + bottom edges only when the workArea is wide/tall enough to
  // accommodate the panel. On degenerate micro-screens (width < 2*MARGIN + PANEL)
  // skip the max-clamp so the min-clamp (SCREEN_MARGIN) still wins — the panel
  // will extend off-screen to the right rather than landing at a negative x.
  const maxX = workArea.x + workArea.width - SCREEN_MARGIN - INPUT_WIDTH;
  const maxY = workArea.y + workArea.height - SCREEN_MARGIN - INPUT_HEIGHT;
  if (maxX >= minX) ix = Math.min(ix, maxX);
  if (maxY >= minY) iy = Math.min(iy, maxY);

  return { x: ix, y: iy, width: INPUT_WIDTH, height: INPUT_HEIGHT };
}
