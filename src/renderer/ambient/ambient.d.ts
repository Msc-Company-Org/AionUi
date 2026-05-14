/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

// Required so that this file is treated as a module; otherwise `declare global` errors.

/** State machine for the Ambient window (M1–M3). */
export type AmbientState = 'bubble' | 'input' | 'chat';

/** File attachment forwarded to main process on submit. */
export interface AttachmentInfo {
  name: string;
  /** Absolute filesystem path (Electron File.path extension). */
  path: string;
  /** File size in bytes. */
  size: number;
  /** Coarse content category — used for icon rendering and filtering. */
  kind: 'image' | 'text' | 'code' | 'document' | 'other';
}

declare global {
  interface Window {
    ambientAPI: {
      // ── M1: drag events ──────────────────────────────────────────────
      dragStart(): void;
      dragEnd(): void;
      /** Click (≤5 px movement) — triggers M2 expand (same as hover). */
      click(): void;

      // ── M2: input state ──────────────────────────────────────────────
      /**
       * Renderer fires after HOVER_EXPAND_MS (300 ms) of cursor dwelling
       * on the bubble. Main process expands window and transitions state.
       */
      hoverExpand(): void;
      /**
       * Collapse input state back to bubble (Esc / blur-while-empty).
       * Ignored if current state is not 'input'.
       */
      collapse(): void;
      /**
       * Submit message + attachments. Main process stubs M3 transition.
       * Renderer must not call this when text and attachments are both empty.
       */
      submit(text: string, attachments: AttachmentInfo[]): void;
      /**
       * Subscribe to state transitions emitted by the main process.
       * Returns a cleanup function that removes the listener.
       */
      onStateChanged(cb: (state: AmbientState) => void): () => void;
    };
  }
}
