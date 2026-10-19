import { clampInteger } from './coordinate.js';

interface ImageViewportOptions {
  viewport: HTMLDivElement;
  content: HTMLElement;
  slider: HTMLInputElement;
  value: HTMLOutputElement;
  resetButton: HTMLButtonElement;
  centeredInFlow?: boolean;
  middleButtonPan?: boolean;
  canInteract?: () => boolean;
  onReset?: () => void;
}

interface PanState {
  pointerId: number;
  buttonMask: number;
  clientX: number;
  clientY: number;
}

const MIN_ZOOM = 10;
const MAX_ZOOM = 3200;

/** Changes only the display; exported image pixels remain untouched. */
export function createImageViewport({
  viewport,
  content,
  slider,
  value,
  resetButton,
  centeredInFlow = false,
  middleButtonPan = false,
  canInteract = () => true,
  onReset,
}: ImageViewportOptions): { setEnabled(enabled: boolean): void; reset(): void } {
  let enabled = false;
  let percent = 100;
  let offsetX = 0;
  let offsetY = 0;
  let pan: PanState | null = null;

  slider.min = String(MIN_ZOOM);
  slider.max = String(MAX_ZOOM);
  slider.step = '1';

  function render(): void {
    const origin = centeredInFlow ? '' : 'translate(-50%, -50%) ';
    content.style.transform = `${origin}translate(${offsetX}px, ${offsetY}px) scale(${percent / 100})`;
    content.style.setProperty('--view-scale', String(percent / 100));
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
    onReset?.();
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
    viewport.classList.toggle('is-interactive', enabled);
    if (!enabled) stopPan();
  }

  viewport.addEventListener('wheel', (event) => {
    if (!enabled) return;
    event.preventDefault();
    if (!canInteract() || event.deltaY === 0) return;
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
    if (!enabled || !canInteract()) {
      render();
      return;
    }
    stopPan();
    zoomTo(slider.valueAsNumber);
  });

  resetButton.addEventListener('click', reset);

  // Prevent browser middle-click autoscroll within the editing viewport.
  viewport.addEventListener('mousedown', (event) => {
    if (middleButtonPan && event.button === 1) event.preventDefault();
  });
  viewport.addEventListener('auxclick', (event) => {
    if (middleButtonPan && event.button === 1) event.preventDefault();
  });

  viewport.addEventListener('pointerdown', (event) => {
    const supportedButton = event.button === 0 || (middleButtonPan && event.button === 1);
    if (!enabled || !canInteract() || event.defaultPrevented || !event.isPrimary || !supportedButton || pan) return;
    event.preventDefault();
    pan = { pointerId: event.pointerId, buttonMask: event.button === 1 ? 4 : 1, clientX: event.clientX, clientY: event.clientY };
    viewport.setPointerCapture(event.pointerId);
    viewport.classList.add('is-panning');
  });

  viewport.addEventListener('pointermove', (event) => {
    if (!pan || event.pointerId !== pan.pointerId) return;
    if (event.pointerType === 'mouse' && (event.buttons & pan.buttonMask) === 0) {
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
