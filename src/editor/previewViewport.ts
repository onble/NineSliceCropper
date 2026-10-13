import { clampInteger } from './coordinate.js';

interface PreviewViewportOptions {
  viewport: HTMLDivElement;
  canvas: HTMLCanvasElement;
  slider: HTMLInputElement;
  value: HTMLOutputElement;
  resetButton: HTMLButtonElement;
}

interface PanState {
  pointerId: number;
  clientX: number;
  clientY: number;
}

const MIN_ZOOM = 10;
const MAX_ZOOM = 3200;

/** Changes only the canvas display; exported image pixels remain untouched. */
export function createPreviewViewport({
  viewport,
  canvas,
  slider,
  value,
  resetButton,
}: PreviewViewportOptions): { setEnabled(enabled: boolean): void; reset(): void } {
  let enabled = false;
  let percent = 100;
  let offsetX = 0;
  let offsetY = 0;
  let pan: PanState | null = null;

  slider.min = String(MIN_ZOOM);
  slider.max = String(MAX_ZOOM);
  slider.step = '1';

  function render(): void {
    canvas.style.transform = `translate(-50%, -50%) translate(${offsetX}px, ${offsetY}px) scale(${percent / 100})`;
    slider.value = String(percent);
    slider.setAttribute('aria-valuetext', `${percent}%`);
    value.value = `${percent}%`;
  }

  function stopPan(): void {
    const previousPan = pan;
    pan = null;
    viewport.classList.remove('is-panning');
    if (previousPan && viewport.hasPointerCapture(previousPan.pointerId)) {
      viewport.releasePointerCapture(previousPan.pointerId);
    }
  }

  function zoomTo(nextPercent: number, anchorX = 0, anchorY = 0): void {
    if (!Number.isFinite(nextPercent)) return;
    const clampedPercent = clampInteger(nextPercent, MIN_ZOOM, MAX_ZOOM);
    const ratio = clampedPercent / percent;
    // Keep the image point beneath the anchor at the same viewport position.
    offsetX = anchorX - (anchorX - offsetX) * ratio;
    offsetY = anchorY - (anchorY - offsetY) * ratio;
    percent = clampedPercent;
    render();
  }

  function reset(): void {
    stopPan();
    percent = 100;
    offsetX = 0;
    offsetY = 0;
    render();
  }

  function setEnabled(nextEnabled: boolean): void {
    enabled = nextEnabled;
    slider.disabled = !enabled;
    resetButton.disabled = !enabled;
    viewport.setAttribute('aria-disabled', String(!enabled));
    if (!enabled) stopPan();
  }

  viewport.addEventListener('wheel', (event) => {
    if (!enabled) return;
    event.preventDefault();
    if (event.deltaY === 0) return;
    stopPan();

    const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? viewport.clientHeight : 1;
    const delta = Math.max(-240, Math.min(240, event.deltaY * unit));
    let nextPercent = Math.round(percent * Math.exp(-delta * 0.002));
    if (nextPercent === percent) nextPercent -= Math.sign(delta);

    const rect = viewport.getBoundingClientRect();
    const anchorX = event.clientX - rect.left - viewport.clientLeft - viewport.clientWidth / 2;
    const anchorY = event.clientY - rect.top - viewport.clientTop - viewport.clientHeight / 2;
    zoomTo(nextPercent, anchorX, anchorY);
  }, { passive: false });

  slider.addEventListener('input', () => {
    if (!enabled) return;
    stopPan();
    zoomTo(slider.valueAsNumber);
  });

  resetButton.addEventListener('click', reset);

  viewport.addEventListener('pointerdown', (event) => {
    if (!enabled || !event.isPrimary || event.button !== 0 || pan) return;
    event.preventDefault();
    pan = { pointerId: event.pointerId, clientX: event.clientX, clientY: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!pan || event.pointerId !== pan.pointerId) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      stopPan();
      return;
    }
    offsetX += event.clientX - pan.clientX;
    offsetY += event.clientY - pan.clientY;
    pan.clientX = event.clientX;
    pan.clientY = event.clientY;
    render();
  });

  const endPointer = (event: PointerEvent): void => {
    if (pan?.pointerId === event.pointerId) stopPan();
  };
  viewport.addEventListener('pointerup', endPointer);
  viewport.addEventListener('pointercancel', endPointer);
  viewport.addEventListener('lostpointercapture', endPointer);
  window.addEventListener('blur', stopPan);

  setEnabled(false);
  render();
  return { setEnabled, reset };
}
