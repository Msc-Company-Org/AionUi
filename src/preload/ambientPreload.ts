/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import type { AmbientState, AttachmentInfo } from '../renderer/ambient/ambient.d';

// Minimal surface the bubble renderer needs. Click-vs-drag threshold is
// evaluated in the renderer (pointer coordinates are renderer-local there);
// main process only sees discrete events.
contextBridge.exposeInMainWorld('ambientAPI', {
  // ── M1: drag ────────────────────────────────────────────────────────
  dragStart: (): void => ipcRenderer.send('ambient:drag-start'),
  dragEnd: (): void => ipcRenderer.send('ambient:drag-end'),
  click: (): void => ipcRenderer.send('ambient:click'),

  // ── M2: input state ─────────────────────────────────────────────────
  hoverExpand: (): void => ipcRenderer.send('ambient:hover-expand'),
  collapse: (): void => ipcRenderer.send('ambient:collapse'),

  submit: (text: string, attachments: AttachmentInfo[]): void =>
    ipcRenderer.send('ambient:submit', { text, attachments }),

  /**
   * Subscribe to state changes pushed by the main process.
   * Callers must invoke the returned cleanup to avoid listener leaks.
   */
  onStateChanged: (cb: (state: AmbientState) => void): (() => void) => {
    const listener = (_evt: IpcRendererEvent, payload: { state: AmbientState }): void => cb(payload.state);
    ipcRenderer.on('ambient:state-changed', listener);
    return (): void => {
      ipcRenderer.removeListener('ambient:state-changed', listener);
    };
  },
});
