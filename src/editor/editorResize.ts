/** Resize the editing area without changing source pixels or slice coordinates. */
export function setupEditorResize(card: HTMLElement, handle: HTMLElement): void {
  const minimum = 360;
  const maximum = 1200;
  const defaultHeight = (): number => Math.max(minimum, Math.min(620, window.innerHeight * 0.55));
  let height = defaultHeight();
  let drag: { pointerId: number; startY: number; height: number } | null = null;

  function setHeight(value: number): void {
    height = Math.round(Math.max(minimum, Math.min(maximum, value)));
    card.style.setProperty('--editor-height', `${height}px`);
    handle.setAttribute('aria-valuenow', String(height));
    handle.setAttribute('aria-valuetext', `${height} 像素`);
  }

  function stop(): void {
    const previous = drag;
    drag = null;
    handle.classList.remove('is-resizing');
    if (previous && handle.hasPointerCapture(previous.pointerId)) {
      handle.releasePointerCapture(previous.pointerId);
    }
  }

  handle.setAttribute('aria-valuemin', String(minimum));
  handle.setAttribute('aria-valuemax', String(maximum));
  setHeight(height);
  handle.addEventListener('pointerdown', (event) => {
    if (!event.isPrimary || event.button !== 0 || drag) return;
    event.preventDefault();
    handle.focus({ preventScroll: true });
    drag = { pointerId: event.pointerId, startY: event.clientY, height };
    handle.setPointerCapture(event.pointerId);
    handle.classList.add('is-resizing');
  });
  handle.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (event.pointerType === 'mouse' && (event.buttons & 1) === 0) {
      stop();
      return;
    }
    setHeight(drag.height + event.clientY - drag.startY);
  });
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    handle.addEventListener(name, (event) => {
      if (drag?.pointerId === event.pointerId) stop();
    });
  }
  window.addEventListener('blur', stop);
  handle.addEventListener('dblclick', () => setHeight(defaultHeight()));
  handle.addEventListener('keydown', (event) => {
    const step = event.shiftKey ? 50 : 10;
    const next = event.key === 'ArrowUp' ? height - step
      : event.key === 'ArrowDown' ? height + step
      : event.key === 'Home' ? minimum
      : event.key === 'End' ? maximum : null;
    if (next === null) return;
    event.preventDefault();
    setHeight(next);
  });
}
