/**
 * @license
 * Copyright 2025 AionUi (aionui.com)
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Ambient bubble + input renderer (M1 + M2).
 *
 * M1 responsibilities (unchanged):
 *   - Detect pointer drag vs click with the 5px threshold (AC-M1-8).
 *   - Fire `ambient:drag-start`, `ambient:drag-end`, `ambient:click` via IPC.
 *   - Restore opacity on blur (drag watchdog complement on renderer side).
 *
 * M2 responsibilities (this file):
 *   - Hover-enter bubble for ≥ HOVER_EXPAND_MS → fire `ambient:hover-expand`.
 *   - Cancel the hover timer on mouse-leave.
 *   - React to `ambient:state-changed` from main → switch CSS state class.
 *   - In 'input' state: auto-resize textarea (max 6 rows), suggestion fill,
 *     Esc/blur-empty collapse, Enter submit, file drag-and-drop with type guard.
 *
 * Black-box contract:
 *   - Main process is the source of truth for state (sends `state-changed`).
 *   - Renderer never writes state to main; it only fires events.
 */

import './ambient.d';
import type { AmbientState, AttachmentInfo } from './ambient.d';

// ── Constants ───────────────────────────────────────────────────────────────

/** AC-M1-8: ≤ 5px movement is a click; > 5px is a drag. */
const CLICK_VS_DRAG_THRESHOLD = 5;

/** AC-M2-1: hover must dwell for 300 ms before expand fires. */
const HOVER_EXPAND_MS = 300;

/** AC-M2-9: textarea auto-resizes up to 6 rows, then shows scrollbar. */
const TEXTAREA_MAX_ROWS = 6;
const TEXTAREA_LINE_HEIGHT_PX = 20;

/** Supported file extensions for drag-and-drop (AC-M2-5 / AC-M2-8). */
const SUPPORTED_EXTENSIONS = new Set<string>([
  // Text
  '.txt',
  '.md',
  '.csv',
  '.json',
  '.xml',
  '.yaml',
  '.yml',
  // Code
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.py',
  '.java',
  '.c',
  '.cpp',
  '.h',
  '.cs',
  '.go',
  '.rs',
  '.rb',
  '.php',
  '.swift',
  // Images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.svg',
  // Documents
  '.pdf',
]);

// ── DOM references ───────────────────────────────────────────────────────────

const bubble = document.querySelector<HTMLDivElement>('[data-testid="ambient-bubble"]');
const inputPanel = document.querySelector<HTMLDivElement>('[data-testid="ambient-input"]');
const textarea = document.querySelector<HTMLTextAreaElement>('[data-testid="ambient-textarea"]');
const sendBtn = document.querySelector<HTMLButtonElement>('[data-testid="ambient-send-btn"]');
const suggestionsEl = document.querySelector<HTMLDivElement>('[data-testid="ambient-suggestions"]');
const attachmentsEl = document.querySelector<HTMLDivElement>('[data-testid="ambient-attachments"]');
const errorEl = document.querySelector<HTMLDivElement>('[data-testid="ambient-error"]');

if (!bubble) console.error('[Ambient] [data-testid="ambient-bubble"] not found — check bubble.html');
if (!textarea) console.error('[Ambient] [data-testid="ambient-textarea"] not found — check bubble.html');

// ── Runtime state ────────────────────────────────────────────────────────────

/** Mirrors the main-process state machine. Updated via onStateChanged IPC. */
let rendererState: AmbientState = 'bubble';

let attachments: AttachmentInfo[] = [];

// M1 drag tracking
let downX = 0;
let downY = 0;
let dragging = false;

// M2 hover timer
let hoverTimer: ReturnType<typeof setTimeout> | null = null;

// ── Helpers ──────────────────────────────────────────────────────────────────

function getFileExtension(filename: string): string {
  const dot = filename.lastIndexOf('.');
  return dot >= 0 ? filename.slice(dot).toLowerCase() : '';
}

function classifyFile(file: File): AttachmentInfo['kind'] | null {
  const ext = getFileExtension(file.name);
  if (!SUPPORTED_EXTENSIONS.has(ext)) return null;
  if (file.type.startsWith('image/') || ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg'].includes(ext))
    return 'image';
  if (
    [
      '.ts',
      '.tsx',
      '.js',
      '.jsx',
      '.py',
      '.java',
      '.c',
      '.cpp',
      '.h',
      '.cs',
      '.go',
      '.rs',
      '.rb',
      '.php',
      '.swift',
    ].includes(ext)
  )
    return 'code';
  if (ext === '.pdf') return 'document';
  return 'text';
}

/** Get the absolute path from an Electron-extended File object. */
function getFilePath(file: File): string {
  return (file as File & { path?: string }).path ?? file.name;
}

// ── Render: attachment chips ──────────────────────────────────────────────────

function renderAttachments(): void {
  if (!attachmentsEl) return;
  attachmentsEl.innerHTML = '';
  for (let i = 0; i < attachments.length; i++) {
    const att = attachments[i];
    const icon = att.kind === 'image' ? '🖼' : att.kind === 'code' ? '💻' : att.kind === 'document' ? '📄' : '📎';
    const chip = document.createElement('div');
    chip.className = 'ambient-attachment';
    chip.dataset['testid'] = `ambient-attachment-${i}`;
    chip.innerHTML = `<span class="att-icon">${icon}</span><span class="att-name" title="${att.name}">${att.name}</span><button class="att-remove" data-idx="${i}" aria-label="Remove ${att.name}">\u00d7</button>`;
    attachmentsEl.appendChild(chip);
  }
  attachmentsEl.hidden = attachments.length === 0;

  // Wire remove buttons
  attachmentsEl.querySelectorAll<HTMLButtonElement>('.att-remove').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const idx = parseInt(btn.dataset['idx'] ?? '0', 10);
      attachments.splice(idx, 1);
      renderAttachments();
      updateSendButton();
    });
  });
}

// ── Render: error message ────────────────────────────────────────────────────

let errorDismissTimer: ReturnType<typeof setTimeout> | null = null;

function showError(msg: string): void {
  if (!errorEl) return;
  errorEl.textContent = msg;
  errorEl.hidden = false;
  if (errorDismissTimer) clearTimeout(errorDismissTimer);
  errorDismissTimer = setTimeout(clearError, 3000);
}

function clearError(): void {
  if (!errorEl) return;
  if (errorDismissTimer) {
    clearTimeout(errorDismissTimer);
    errorDismissTimer = null;
  }
  errorEl.hidden = true;
  errorEl.textContent = '';
}

// ── Send button state ────────────────────────────────────────────────────────

function updateSendButton(): void {
  if (!sendBtn || !textarea) return;
  const hasContent = textarea.value.trim() !== '' || attachments.length > 0;
  sendBtn.disabled = !hasContent;
}

// ── Textarea auto-resize (AC-M2-9) ───────────────────────────────────────────

function resizeTextarea(): void {
  if (!textarea) return;
  textarea.style.height = 'auto';
  const maxHeight = TEXTAREA_LINE_HEIGHT_PX * TEXTAREA_MAX_ROWS + 16; // 16px for padding
  const newHeight = Math.min(textarea.scrollHeight, maxHeight);
  textarea.style.height = `${newHeight}px`;
  textarea.style.overflowY = textarea.scrollHeight > maxHeight ? 'auto' : 'hidden';
}

// ── Submit ───────────────────────────────────────────────────────────────────

function submitMessage(): void {
  const text = textarea?.value.trim() ?? '';
  if (text === '' && attachments.length === 0) return;
  window.ambientAPI.submit(text, attachments);
  // Optimistic clear; main process drives state-changed → 'chat' when M3 lands.
  // For now clear so the UI doesn't look stuck.
  if (textarea) {
    textarea.value = '';
    resizeTextarea();
  }
  attachments = [];
  renderAttachments();
  updateSendButton();
}

// ── Collapse ─────────────────────────────────────────────────────────────────

function collapseTobubbble(): void {
  window.ambientAPI.collapse();
  // Renderer state update comes via 'ambient:state-changed' → 'bubble'.
}

// ── State transition ─────────────────────────────────────────────────────────

function transitionToState(newState: AmbientState): void {
  rendererState = newState;
  document.body.className = `state-${newState}`;

  if (newState === 'input') {
    // Slight delay so the window resize completes before we focus.
    setTimeout(() => {
      textarea?.focus();
    }, 50);
  }

  if (newState === 'bubble') {
    // Reset input state for the next hover.
    if (textarea) {
      textarea.value = '';
      textarea.style.height = 'auto';
      textarea.style.overflowY = 'hidden';
    }
    attachments = [];
    renderAttachments();
    updateSendButton();
    clearError();
  }
}

// Subscribe to state changes from main process.
const unsubscribeState = window.ambientAPI.onStateChanged((state) => {
  transitionToState(state);
});
// Keep reference to avoid tree-shaking; cleanup would happen on page unload.
void unsubscribeState;

// ── M1: Drag handlers ────────────────────────────────────────────────────────

function onMouseDown(event: MouseEvent): void {
  if (event.button !== 0) return;
  downX = event.screenX;
  downY = event.screenY;
  dragging = true;
  bubble?.classList.add('dragging');
  window.ambientAPI.dragStart();
}

function onMouseUp(event: MouseEvent): void {
  if (!dragging) return;
  dragging = false;
  bubble?.classList.remove('dragging');

  const dx = event.screenX - downX;
  const dy = event.screenY - downY;
  const distance = Math.hypot(dx, dy);

  window.ambientAPI.dragEnd();

  // AC-M1-8 / AC-M2-1: clicks trigger M2 expand.
  if (distance <= CLICK_VS_DRAG_THRESHOLD) {
    window.ambientAPI.click();
  }
}

// ── M2: Hover expand ─────────────────────────────────────────────────────────

function onMouseEnterBubble(): void {
  if (rendererState !== 'bubble') return;
  if (hoverTimer) return;
  // AC-M2-1: 300 ms dwell before expand fires.
  hoverTimer = setTimeout(() => {
    hoverTimer = null;
    if (rendererState === 'bubble') {
      window.ambientAPI.hoverExpand();
    }
  }, HOVER_EXPAND_MS);
}

function onMouseLeaveBubble(): void {
  if (hoverTimer) {
    clearTimeout(hoverTimer);
    hoverTimer = null;
  }
}

// ── M2: Textarea events ───────────────────────────────────────────────────────

function onTextareaInput(): void {
  resizeTextarea();
  updateSendButton();
}

function onTextareaKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape') {
    event.preventDefault();
    collapseTobubbble();
    return;
  }
  // Enter without Shift submits; Shift+Enter inserts a newline.
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    submitMessage();
  }
}

// ── M2: Suggestion click (AC-M2-3) ───────────────────────────────────────────

function onSuggestionClick(event: MouseEvent): void {
  const btn = (event.target as HTMLElement).closest<HTMLButtonElement>('.ambient-suggestion');
  if (!btn || !textarea) return;
  // Use data-text so the fill text is clean (no emoji prefix).
  const text = btn.dataset['text'] ?? btn.textContent?.trim() ?? '';
  textarea.value = text;
  resizeTextarea();
  updateSendButton();
  textarea.focus();
  textarea.setSelectionRange(text.length, text.length);
  // AC-M2-3: not auto-sent. User must press Enter or click Send.
}

// ── M2: File drag-and-drop (AC-M2-5, AC-M2-8) ───────────────────────────────

function onDragOver(event: DragEvent): void {
  event.preventDefault();
  inputPanel?.classList.add('drag-over');
}

function onDragLeave(event: DragEvent): void {
  // Only remove highlight if leaving the panel entirely (not a child element).
  if (inputPanel && !inputPanel.contains(event.relatedTarget as Node | null)) {
    inputPanel.classList.remove('drag-over');
  }
}

function onDrop(event: DragEvent): void {
  event.preventDefault();
  inputPanel?.classList.remove('drag-over');

  const files = Array.from(event.dataTransfer?.files ?? []);
  let hadUnsupported = false;

  for (const file of files) {
    const kind = classifyFile(file);
    if (!kind) {
      // AC-M2-8: unsupported type → show error, do not mount.
      hadUnsupported = true;
      showError(`不支持的文件类型：${file.name}`);
      continue;
    }
    // Deduplicate by path.
    const filePath = getFilePath(file);
    if (attachments.some((a) => a.path === filePath)) continue;
    attachments.push({ name: file.name, path: filePath, size: file.size, kind });
  }

  if (!hadUnsupported) clearError();
  renderAttachments();
  updateSendButton();
}

// ── M1/M2: Window blur ───────────────────────────────────────────────────────

function onWindowBlur(): void {
  // M1: end drag if renderer loses focus before mouseup arrives.
  if (dragging) {
    dragging = false;
    bubble?.classList.remove('dragging');
    window.ambientAPI.dragEnd();
  }

  // M2 (AC-M2-6/7): collapse only when input is empty.
  if (rendererState === 'input') {
    const hasContent = (textarea?.value.trim() ?? '') !== '' || attachments.length > 0;
    if (!hasContent) {
      collapseTobubbble();
    }
    // AC-M2-7: if there is content, do NOT collapse — user may be pasting
    // from another app or clicking a reference doc.
  }
}

// ── Wire up all event listeners ───────────────────────────────────────────────

// M1 drag (bubble element)
if (bubble) {
  bubble.addEventListener('mousedown', onMouseDown);
  bubble.addEventListener('mouseenter', onMouseEnterBubble);
  bubble.addEventListener('mouseleave', onMouseLeaveBubble);
}
// mouseup on document so a fast drag that leaves the 56px element still fires.
document.addEventListener('mouseup', onMouseUp);

// M2 textarea
if (textarea) {
  textarea.addEventListener('input', onTextareaInput);
  textarea.addEventListener('keydown', onTextareaKeydown);
}

// M2 send button
sendBtn?.addEventListener('click', submitMessage);

// M2 suggestions
suggestionsEl?.addEventListener('click', onSuggestionClick);

// M2 file drop on the whole input panel
if (inputPanel) {
  inputPanel.addEventListener('dragover', onDragOver);
  inputPanel.addEventListener('dragleave', onDragLeave);
  inputPanel.addEventListener('drop', onDrop);
}

// Shared blur handler (M1 drag cleanup + M2 collapse-if-empty)
window.addEventListener('blur', onWindowBlur);
