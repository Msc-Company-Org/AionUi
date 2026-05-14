/**
 * Unit tests for Ambient Mode geometry — pure math functions.
 *
 * Covers `computeInputBounds` from `ambientGeometry.ts` (no Electron dependency).
 *
 * AC coverage: AC-M2-1 (window sizing on expand), AC-M2-6 (collapse restore bounds).
 */
import { describe, it, expect } from 'vitest';
import {
  computeInputBounds,
  BUBBLE_SIZE,
  SCREEN_MARGIN,
  INPUT_WIDTH,
  INPUT_HEIGHT,
} from '../../src/process/ambient/ambientGeometry';

// Standard full-HD workArea (single-monitor, origin at 0,0)
const WA_1080P = { x: 0, y: 0, width: 1920, height: 1080 };
// MacBook 13″ workArea with Dock (~46 px bottom) already subtracted
const WA_MACBOOK = { x: 0, y: 0, width: 1440, height: 854 };

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Bubble at the canonical "bottom-right" snapped position. */
function bottomRightBubble(wa: typeof WA_1080P): { x: number; y: number } {
  return {
    x: wa.x + wa.width - SCREEN_MARGIN - BUBBLE_SIZE,
    y: wa.y + wa.height - SCREEN_MARGIN - BUBBLE_SIZE,
  };
}

/** Bubble at the canonical "bottom-left" snapped position. */
function bottomLeftBubble(wa: typeof WA_1080P): { x: number; y: number } {
  return {
    x: wa.x + SCREEN_MARGIN,
    y: wa.y + wa.height - SCREEN_MARGIN - BUBBLE_SIZE,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeInputBounds', () => {
  describe('output dimensions', () => {
    it('always returns INPUT_WIDTH × INPUT_HEIGHT', () => {
      const { width, height } = computeInputBounds(500, 500, WA_1080P);
      expect(width).toBe(INPUT_WIDTH);
      expect(height).toBe(INPUT_HEIGHT);
    });

    it('dimensions are correct even on a small screen', () => {
      const { width, height } = computeInputBounds(100, 100, WA_MACBOOK);
      expect(width).toBe(INPUT_WIDTH);
      expect(height).toBe(INPUT_HEIGHT);
    });
  });

  describe('right-edge anchor (bubble snapped to right)', () => {
    it('right edge of input panel aligns with right edge of bubble (1080p)', () => {
      const { x: bx, y: by } = bottomRightBubble(WA_1080P);
      const bounds = computeInputBounds(bx, by, WA_1080P);
      expect(bounds.x + bounds.width).toBe(bx + BUBBLE_SIZE);
    });

    it('bottom edge of input panel aligns with bottom edge of bubble (1080p)', () => {
      const { x: bx, y: by } = bottomRightBubble(WA_1080P);
      const bounds = computeInputBounds(bx, by, WA_1080P);
      expect(bounds.y + bounds.height).toBe(by + BUBBLE_SIZE);
    });

    it('right edge of input panel aligns with right edge of bubble (MacBook)', () => {
      const { x: bx, y: by } = bottomRightBubble(WA_MACBOOK);
      const bounds = computeInputBounds(bx, by, WA_MACBOOK);
      expect(bounds.x + bounds.width).toBe(bx + BUBBLE_SIZE);
    });
  });

  describe('left-edge clamp (bubble snapped to left)', () => {
    it('x is clamped to workArea.x + SCREEN_MARGIN when bubble is at left edge', () => {
      const { x: bx, y: by } = bottomLeftBubble(WA_1080P);
      const bounds = computeInputBounds(bx, by, WA_1080P);
      // Natural ix = bx + BUBBLE_SIZE - INPUT_WIDTH < 0 → must clamp.
      expect(bounds.x).toBe(WA_1080P.x + SCREEN_MARGIN);
    });

    it('dimensions remain correct after left-edge clamp', () => {
      const { x: bx, y: by } = bottomLeftBubble(WA_1080P);
      const bounds = computeInputBounds(bx, by, WA_1080P);
      expect(bounds.width).toBe(INPUT_WIDTH);
      expect(bounds.height).toBe(INPUT_HEIGHT);
    });
  });

  describe('top-edge clamp (bubble near top)', () => {
    it('y is clamped to workArea.y + SCREEN_MARGIN when bubble is near top', () => {
      const bx = 1000;
      const by = WA_1080P.y + SCREEN_MARGIN; // near top
      const bounds = computeInputBounds(bx, by, WA_1080P);
      // Natural iy = by + BUBBLE_SIZE - INPUT_HEIGHT < workArea.y + SCREEN_MARGIN → clamp.
      expect(bounds.y).toBeGreaterThanOrEqual(WA_1080P.y + SCREEN_MARGIN);
    });
  });

  describe('workArea with non-zero origin (secondary monitor)', () => {
    const WA_SECONDARY = { x: 1920, y: 0, width: 1920, height: 1080 };

    it('output x respects secondary-monitor origin', () => {
      const bx = WA_SECONDARY.x + WA_SECONDARY.width - SCREEN_MARGIN - BUBBLE_SIZE;
      const by = WA_SECONDARY.y + WA_SECONDARY.height - SCREEN_MARGIN - BUBBLE_SIZE;
      const bounds = computeInputBounds(bx, by, WA_SECONDARY);
      expect(bounds.x).toBeGreaterThanOrEqual(WA_SECONDARY.x + SCREEN_MARGIN);
      expect(bounds.x + bounds.width).toBeLessThanOrEqual(WA_SECONDARY.x + WA_SECONDARY.width - SCREEN_MARGIN);
    });

    it('output y stays within secondary-monitor workArea', () => {
      const bx = WA_SECONDARY.x + 500;
      const by = WA_SECONDARY.y + WA_SECONDARY.height - SCREEN_MARGIN - BUBBLE_SIZE;
      const bounds = computeInputBounds(bx, by, WA_SECONDARY);
      expect(bounds.y).toBeGreaterThanOrEqual(WA_SECONDARY.y + SCREEN_MARGIN);
      expect(bounds.y + bounds.height).toBeLessThanOrEqual(WA_SECONDARY.y + WA_SECONDARY.height - SCREEN_MARGIN);
    });
  });

  describe('idempotency (already-expanded position does not drift)', () => {
    it('running computeInputBounds twice with the same inputs yields the same result', () => {
      const { x: bx, y: by } = bottomRightBubble(WA_1080P);
      const first = computeInputBounds(bx, by, WA_1080P);
      const second = computeInputBounds(bx, by, WA_1080P);
      expect(second).toEqual(first);
    });
  });

  describe('edge: degenerate workArea (very small screen)', () => {
    it('does not throw when workArea is smaller than INPUT_WIDTH', () => {
      const tinyWA = { x: 0, y: 0, width: 320, height: 568 };
      expect(() => computeInputBounds(100, 300, tinyWA)).not.toThrow();
    });

    it('clamps correctly on a small screen without negative x', () => {
      const tinyWA = { x: 0, y: 0, width: 320, height: 568 };
      const bounds = computeInputBounds(100, 300, tinyWA);
      // x must be ≥ SCREEN_MARGIN (min clamp wins over max when screen < panel)
      expect(bounds.x).toBeGreaterThanOrEqual(SCREEN_MARGIN);
      expect(bounds.width).toBe(INPUT_WIDTH);
    });
  });
});
