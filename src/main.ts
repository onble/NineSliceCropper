import './style.css';
import { clampInteger, displayToSourcePixel } from './editor/coordinate.js';
import { createPreviewViewport } from './editor/previewViewport.js';
import { calculateNineSliceRegions, composeNineSlice, validateSliceBounds } from './image/cropNineSlice.js';
import { createWorkerPngOptimizer, optimizePng } from './image/optimizePng.js';
import { composeHorizontalMirror, symmetricSliceBounds, type MirrorMode } from './image/mirrorImage.js';
import { buildExportFileName, validateFileNameSuffix } from './image/exportFileName.js';
import type { ImageSize, SliceBounds } from './types.js';

type BoundKey = keyof SliceBounds;

interface LoadedImage {
  element: HTMLImageElement;
  fileName: string;
  objectUrl: string;
  size: ImageSize;
}

interface DragState {
  key: BoundKey;
  pointerId: number;
  target: HTMLElement;
}

const app = document.querySelector<HTMLDivElement>('#app');
if (!app) throw new Error('找不到应用根节点。');

app.innerHTML = `
  <main class="app-shell">
    <header class="app-header">
      <div>
        <p class="eyebrow">浏览器本地像素工具</p>
        <h1>NineSlice<span>Cropper</span></h1>
        <p class="subtitle">删除可拉伸的中间区域，完整保留四角像素。</p>
      </div>
      <div class="actions" aria-label="文件操作">
        <label class="button button-primary" for="file-input" role="button" tabindex="0">上传 PNG</label>
        <input id="file-input" type="file" accept="image/png,.png" hidden />
        <button id="reset-button" class="button" type="button" disabled>重置</button>
        <button id="export-button" class="button button-accent" type="button" disabled>导出 PNG</button>
      </div>
    </header>

    <p id="status" class="status" role="status" aria-live="polite"></p>

    <section class="workspace">
      <article id="editor-card" class="panel editor-card">
        <div class="panel-heading">
          <div>
            <p class="section-label">源图片</p>
            <h2 id="source-title">尚未加载图片</h2>
          </div>
          <span id="source-size" class="size-badge">—</span>
        </div>

        <div id="drop-zone" class="drop-zone">
          <div id="empty-state" class="empty-state">
            <div class="upload-mark" aria-hidden="true">↥</div>
            <strong>将 PNG 拖到这里</strong>
            <span>也可以点击“上传 PNG” · 图片不会离开你的浏览器</span>
          </div>
          <div id="editor-stage" class="editor-stage" hidden>
            <canvas id="editor-canvas" aria-label="源图片编辑器"></canvas>
            <div class="guide vertical" data-key="left" role="slider" aria-label="左侧切片线" tabindex="0"></div>
            <div class="guide vertical" data-key="right" role="slider" aria-label="右侧切片线" tabindex="0"></div>
            <div class="guide horizontal" data-key="top" role="slider" aria-label="上侧切片线" tabindex="0"></div>
            <div class="guide horizontal" data-key="bottom" role="slider" aria-label="下侧切片线" tabindex="0"></div>
          </div>
        </div>
        <p class="editor-hint">拖动切片线进行调整；聚焦后也可使用方向键，或在右侧输入精确的源图像素。</p>
      </article>

      <aside class="side-column">
        <section class="panel settings-panel">
          <div class="panel-heading compact">
            <div>
              <p class="section-label">切片边界</p>
              <h2>源图坐标</h2>
            </div>
            <span class="unit">px</span>
          </div>
          <div class="field-grid">
            <label><span>左侧</span><input id="left-input" data-key="left" type="number" step="1" inputmode="numeric" disabled /></label>
            <label><span>右侧 X</span><input id="right-input" data-key="right" type="number" step="1" inputmode="numeric" disabled /></label>
            <label><span>上侧</span><input id="top-input" data-key="top" type="number" step="1" inputmode="numeric" disabled /></label>
            <label><span>下侧 Y</span><input id="bottom-input" data-key="bottom" type="number" step="1" inputmode="numeric" disabled /></label>
          </div>
          <p id="bounds-error" class="field-error" aria-live="polite"></p>
          <div class="mirror-settings">
            <label for="mirror-mode">左右对称修复</label>
            <select id="mirror-mode" aria-describedby="mirror-hint" disabled>
              <option value="none">保持原图</option>
              <option value="left">以左侧为准 → 镜像到右侧</option>
              <option value="right">以右侧为准 → 镜像到左侧</option>
            </select>
            <p id="mirror-hint" class="mirror-hint">选择保留的一侧，将它镜像到另一侧，修复左右不对称。</p>
          </div>
        </section>

        <section class="panel result-panel">
          <p class="section-label">输出结果</p>
          <div id="output-size" class="output-size">— <span>px</span></div>
          <p>仅保留四角，按原始分辨率拼接；导出时自动进行无损 PNG 优化。</p>
          <p id="export-detail" class="export-detail" aria-live="polite"></p>
          <div class="export-name-settings">
            <label class="suffix-toggle" for="suffix-enabled">
              <span>添加文件名尾缀</span>
              <input id="suffix-enabled" type="checkbox" role="switch" checked aria-controls="suffix-field" />
            </label>
            <div id="suffix-field" class="suffix-field">
              <label for="filename-suffix">自定义尾缀</label>
              <input id="filename-suffix" type="text" value="-九宫格裁剪" autocomplete="off" spellcheck="false" aria-describedby="suffix-hint suffix-error" />
              <p id="suffix-hint" class="suffix-hint">包含连接符，添加在 .png 之前；离开输入框时校验。</p>
              <p id="suffix-error" class="field-error" aria-live="polite"></p>
            </div>
            <p class="suffix-hint">关闭后按原文件名导出。添加尾缀时，镜像方向标记仍会保留。</p>
          </div>
        </section>

        <section class="panel cocos-panel">
          <div class="panel-heading compact">
            <div>
              <p class="section-label">Cocos Creator</p>
              <h2>边距值</h2>
            </div>
            <button id="copy-button" class="text-button" type="button" disabled>复制 JSON</button>
          </div>
          <dl class="inset-grid">
            <div><dt>左</dt><dd id="cocos-left">—</dd></div>
            <div><dt>右</dt><dd id="cocos-right">—</dd></div>
            <div><dt>上</dt><dd id="cocos-top">—</dd></div>
            <div><dt>下</dt><dd id="cocos-bottom">—</dd></div>
          </dl>
        </section>
      </aside>
    </section>

    <section class="panel preview-panel">
      <div class="panel-heading">
        <div>
          <p class="section-label">实时输出</p>
          <h2>四角拼接预览</h2>
        </div>
        <span id="preview-size" class="size-badge">—</span>
      </div>
      <div id="preview-empty" class="preview-empty">裁剪结果将在这里实时显示。</div>
      <div id="preview-wrap" class="preview-wrap" aria-label="可缩放和拖动的输出预览" aria-describedby="preview-hint" hidden>
        <canvas id="output-canvas" aria-label="九宫格裁剪输出预览"></canvas>
      </div>
      <div class="preview-controls" aria-label="预览视图控制">
        <label for="preview-zoom">缩放</label>
        <input id="preview-zoom" type="range" min="10" max="3200" step="1" value="100" disabled />
        <output id="preview-zoom-value" for="preview-zoom">100%</output>
        <button id="preview-reset" class="button preview-reset" type="button" disabled>1:1 居中复位</button>
      </div>
      <p id="preview-hint" class="preview-hint">滚轮放大 / 缩小 · 按住鼠标左键拖动 · 仅调整预览显示比例</p>
    </section>
  </main>
`;

const byId = <T extends HTMLElement>(id: string): T => {
  const element = document.getElementById(id);
  if (!element) throw new Error(`找不到页面元素 #${id}`);
  return element as T;
};

const fileInput = byId<HTMLInputElement>('file-input');
const resetButton = byId<HTMLButtonElement>('reset-button');
const exportButton = byId<HTMLButtonElement>('export-button');
const copyButton = byId<HTMLButtonElement>('copy-button');
const status = byId<HTMLParagraphElement>('status');
const sourceTitle = byId<HTMLHeadingElement>('source-title');
const sourceSize = byId<HTMLSpanElement>('source-size');
const dropZone = byId<HTMLDivElement>('drop-zone');
const emptyState = byId<HTMLDivElement>('empty-state');
const editorStage = byId<HTMLDivElement>('editor-stage');
const editorCanvas = byId<HTMLCanvasElement>('editor-canvas');
const outputCanvas = byId<HTMLCanvasElement>('output-canvas');
const previewEmpty = byId<HTMLDivElement>('preview-empty');
const previewWrap = byId<HTMLDivElement>('preview-wrap');
const previewSize = byId<HTMLSpanElement>('preview-size');
const outputSize = byId<HTMLDivElement>('output-size');
const boundsError = byId<HTMLParagraphElement>('bounds-error');
const exportDetail = byId<HTMLParagraphElement>('export-detail');
const mirrorSelect = byId<HTMLSelectElement>('mirror-mode');
const mirrorHint = byId<HTMLParagraphElement>('mirror-hint');
const suffixEnabled = byId<HTMLInputElement>('suffix-enabled');
const suffixField = byId<HTMLDivElement>('suffix-field');
const suffixInput = byId<HTMLInputElement>('filename-suffix');
const suffixError = byId<HTMLParagraphElement>('suffix-error');
const previewViewport = createPreviewViewport({
  viewport: previewWrap,
  canvas: outputCanvas,
  slider: byId<HTMLInputElement>('preview-zoom'),
  value: byId<HTMLOutputElement>('preview-zoom-value'),
  resetButton: byId<HTMLButtonElement>('preview-reset'),
});
const inputs = Object.fromEntries(
  [...document.querySelectorAll<HTMLInputElement>('input[data-key]')].map((input) => [input.dataset.key, input]),
) as Record<BoundKey, HTMLInputElement>;
const guides = Object.fromEntries(
  [...document.querySelectorAll<HTMLElement>('.guide')].map((guide) => [guide.dataset.key, guide]),
) as Record<BoundKey, HTMLElement>;

let loaded: LoadedImage | null = null;
let bounds: SliceBounds | null = null;
let resetBounds: SliceBounds | null = null;
let mirrorMode: MirrorMode = 'none';
let drag: DragState | null = null;
let inputIsValid = true;
let suffixIsValid = true;
let exporting = false;
let loadRequestId = 0;
let exportRequestId = 0;
let exportAbortController: AbortController | null = null;

const workerOptimizer = createWorkerPngOptimizer(() => new Worker(
  new URL('./image/optimizePng.worker.ts', import.meta.url),
  { type: 'module' },
));

function setStatus(message: string, kind: 'normal' | 'error' | 'success' = 'normal'): void {
  status.textContent = message;
  status.dataset.kind = kind;
}

function defaultBounds(size: ImageSize): SliceBounds {
  return {
    left: Math.max(1, Math.floor(size.width / 3)),
    right: Math.min(size.width - 1, Math.ceil((size.width * 2) / 3)),
    top: Math.max(1, Math.floor(size.height / 3)),
    bottom: Math.min(size.height - 1, Math.ceil((size.height * 2) / 3)),
  };
}

function setControlsEnabled(enabled: boolean): void {
  previewViewport.setEnabled(enabled);
  for (const input of Object.values(inputs)) input.disabled = !enabled;
  mirrorSelect.disabled = !enabled;
  for (const guide of Object.values(guides)) {
    guide.tabIndex = enabled ? 0 : -1;
    guide.classList.toggle('disabled', !enabled);
  }
  resetButton.disabled = !loaded;
  copyButton.disabled = !enabled || !inputIsValid;
  exportButton.disabled = !enabled || !inputIsValid || !suffixIsValid || exporting;
}

function validateSuffix(): boolean {
  const error = suffixEnabled.checked ? validateFileNameSuffix(suffixInput.value) : null;
  suffixIsValid = error === null;
  suffixError.textContent = error ?? '';
  suffixInput.setCustomValidity(error ?? '');
  if (error) suffixInput.setAttribute('aria-invalid', 'true');
  else suffixInput.removeAttribute('aria-invalid');
  setControlsEnabled(Boolean(loaded && bounds));
  return suffixIsValid;
}

function invalidateExport(): void {
  exportRequestId += 1;
  exportAbortController?.abort();
  exportAbortController = null;
  if (exporting) setStatus('设置已改变，请重新导出。');
  exporting = false;
  exportDetail.textContent = '';
}

function boundRange(key: BoundKey): { minimum: number; maximum: number } {
  if (!loaded || !bounds) return { minimum: 1, maximum: 1 };
  if (mirrorMode !== 'none' && key === 'left') {
    return { minimum: 1, maximum: Math.floor(loaded.size.width / 2) };
  }
  if (mirrorMode !== 'none' && key === 'right') {
    return { minimum: Math.ceil(loaded.size.width / 2), maximum: loaded.size.width - 1 };
  }
  return {
    minimum: key === 'right' ? bounds.left : key === 'bottom' ? bounds.top : 1,
    maximum: key === 'left' ? bounds.right : key === 'top' ? bounds.bottom
      : (key === 'right' ? loaded.size.width : loaded.size.height) - 1,
  };
}

function changeBound(key: BoundKey, value: number): void {
  if (!loaded || !bounds) return;
  const { minimum, maximum } = boundRange(key);
  bounds = { ...bounds, [key]: clampInteger(value, minimum, maximum) };
  if (mirrorMode !== 'none' && (key === 'left' || key === 'right')) {
    bounds = symmetricSliceBounds(loaded.size, bounds, key);
  }
  render();
}

function syncInputs(): void {
  if (!bounds) return;
  for (const key of Object.keys(inputs) as BoundKey[]) {
    inputs[key].value = String(bounds[key]);
    inputs[key].removeAttribute('aria-invalid');
  }
  inputIsValid = true;
  boundsError.textContent = '';
}

function updateGuidePositions(): void {
  if (!loaded || !bounds) return;
  guides.left.style.left = `${(bounds.left / loaded.size.width) * 100}%`;
  guides.right.style.left = `${(bounds.right / loaded.size.width) * 100}%`;
  guides.top.style.top = `${(bounds.top / loaded.size.height) * 100}%`;
  guides.bottom.style.top = `${(bounds.bottom / loaded.size.height) * 100}%`;

  for (const key of Object.keys(guides) as BoundKey[]) {
    const guide = guides[key];
    const vertical = key === 'left' || key === 'right';
    guide.setAttribute('aria-valuenow', String(bounds[key]));
    guide.setAttribute('aria-orientation', vertical ? 'horizontal' : 'vertical');
    const { minimum, maximum } = boundRange(key);
    guide.setAttribute('aria-valuemin', String(minimum));
    guide.setAttribute('aria-valuemax', String(maximum));
    inputs[key].min = String(minimum);
    inputs[key].max = String(maximum);
  }
}

function updateDerived(): void {
  if (!loaded || !bounds) return;
  const regions = calculateNineSliceRegions(loaded.size, bounds);
  const label = `${regions.outputSize.width} × ${regions.outputSize.height}`;
  outputSize.innerHTML = `${label} <span>px</span>`;
  previewSize.textContent = `${label} px`;
  byId('cocos-left').textContent = String(bounds.left);
  byId('cocos-right').textContent = String(loaded.size.width - bounds.right);
  byId('cocos-top').textContent = String(bounds.top);
  byId('cocos-bottom').textContent = String(loaded.size.height - bounds.bottom);
  composeNineSlice(mirrorMode === 'none' ? loaded.element : editorCanvas, loaded.size, bounds, outputCanvas);
  previewEmpty.hidden = true;
  previewWrap.hidden = false;
}

function render(syncFields = true): void {
  if (!loaded || !bounds) return;
  invalidateExport();
  if (syncFields) syncInputs();
  updateGuidePositions();
  updateDerived();
  setControlsEnabled(true);
}

function parseDraftBounds(): SliceBounds | null {
  const draft = {} as SliceBounds;
  for (const key of Object.keys(inputs) as BoundKey[]) {
    const text = inputs[key].value.trim();
    if (!/^-?\d+$/.test(text)) return null;
    const value = Number(text);
    if (!Number.isSafeInteger(value)) return null;
    draft[key] = value;
  }
  return draft;
}

function validateDraft(changedKey: BoundKey): void {
  if (!loaded || !bounds) return;
  const draft = parseDraftBounds();
  try {
    if (!draft) throw new RangeError('请在每个输入框中填写整数源图像素值。');
    if (mirrorMode !== 'none') {
      if (changedKey === 'left' || changedKey === 'right') {
        const inset = changedKey === 'left' ? draft.left : loaded.size.width - draft.right;
        const maximum = Math.floor(loaded.size.width / 2);
        if (inset < 1 || inset > maximum) {
          throw new RangeError(`镜像模式下，左右保留宽度必须在 1 到 ${maximum} 像素之间。`);
        }
        draft.left = inset;
        draft.right = loaded.size.width - inset;
      }
      if (draft.left !== loaded.size.width - draft.right) {
        throw new RangeError('请先修正左右切片线，镜像模式下左右保留宽度必须相同。');
      }
    }
    validateSliceBounds(loaded.size, draft);
    bounds = draft;
    inputIsValid = true;
    boundsError.textContent = '';
    for (const input of Object.values(inputs)) input.removeAttribute('aria-invalid');
    if (mirrorMode !== 'none') {
      inputs.left.value = String(bounds.left);
      inputs.right.value = String(bounds.right);
    }
    render(false);
  } catch (error) {
    invalidateExport();
    inputIsValid = false;
    boundsError.textContent = error instanceof Error ? error.message : '切片边界无效。';
    for (const input of Object.values(inputs)) input.setAttribute('aria-invalid', 'true');
    setControlsEnabled(true);
  }
}

function drawSource(): void {
  if (!loaded) return;
  composeHorizontalMirror(loaded.element, loaded.size, mirrorMode, editorCanvas);
  mirrorHint.textContent = mirrorMode === 'none'
    ? '选择保留的一侧，将它镜像到另一侧，修复左右不对称。'
    : `保留${mirrorMode === 'left' ? '左' : '右'}半边并镜像到另一半；左右切片线联动，预览和导出同步生效。`;
}

async function decodePng(file: File): Promise<LoadedImage> {
  const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
  const pngSignature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.length !== pngSignature.length || signature.some((value, index) => value !== pngSignature[index])) {
    throw new Error('请选择有效的 PNG 文件。');
  }
  const objectUrl = URL.createObjectURL(file);
  const element = new Image();
  element.decoding = 'async';
  element.src = objectUrl;
  try {
    await element.decode();
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error('无法读取这个 PNG，文件可能已损坏或尺寸过大。');
  }
  if (!element.naturalWidth || !element.naturalHeight) {
    URL.revokeObjectURL(objectUrl);
    throw new Error('这个 PNG 中没有可读取的像素。');
  }
  return {
    element,
    fileName: file.name,
    objectUrl,
    size: { width: element.naturalWidth, height: element.naturalHeight },
  };
}

async function loadFile(file: File): Promise<void> {
  exportRequestId += 1;
  exportAbortController?.abort();
  exportAbortController = null;
  exporting = false;
  const requestId = ++loadRequestId;
  let next: LoadedImage | null = null;
  setStatus(`正在加载 ${file.name}…`);
  try {
    next = await decodePng(file);
    if (requestId !== loadRequestId) {
      URL.revokeObjectURL(next.objectUrl);
      return;
    }
    // Exercise browser canvas allocation before replacing a valid session.
    // If a very large image cannot be processed, the previous image stays intact.
    const sourceProbe = document.createElement('canvas');
    sourceProbe.width = next.size.width;
    sourceProbe.height = next.size.height;
    const sourceProbeContext = sourceProbe.getContext('2d');
    if (!sourceProbeContext) throw new Error('当前浏览器无法创建 2D 画布。');
    sourceProbeContext.drawImage(next.element, 0, 0);
    if (next.size.width >= 2 && next.size.height >= 2) {
      const initialBounds = defaultBounds(next.size);
      composeNineSlice(next.element, next.size, initialBounds);
    }
    if (requestId !== loadRequestId) {
      URL.revokeObjectURL(next.objectUrl);
      return;
    }

    const previous = loaded;
    loaded = next;
    previewViewport.reset();
    mirrorMode = 'none';
    mirrorSelect.value = mirrorMode;
    sourceTitle.textContent = next.fileName;
    sourceSize.textContent = `${next.size.width} × ${next.size.height} px`;
    exportDetail.textContent = '';
    emptyState.hidden = true;
    editorStage.hidden = false;
    editorStage.style.setProperty('--image-ratio', String(next.size.width / next.size.height));
    drawSource();

    if (next.size.width < 2 || next.size.height < 2) {
      bounds = null;
      resetBounds = null;
      for (const guide of Object.values(guides)) guide.hidden = true;
      setControlsEnabled(false);
      resetButton.disabled = false;
      outputSize.innerHTML = '无法裁剪';
      previewSize.textContent = '—';
      previewEmpty.hidden = false;
      previewWrap.hidden = true;
      setStatus('图片可以预览，但九宫格裁剪至少需要 2 × 2 像素。', 'error');
    } else {
      for (const guide of Object.values(guides)) guide.hidden = false;
      bounds = defaultBounds(next.size);
      resetBounds = { ...bounds };
      render();
      setStatus(`${next.fileName} 已加载，可以开始调整。`, 'success');
    }

    if (previous) URL.revokeObjectURL(previous.objectUrl);
  } catch (error) {
    if (next && loaded?.objectUrl !== next.objectUrl) URL.revokeObjectURL(next.objectUrl);
    if (requestId === loadRequestId) {
      setStatus(error instanceof Error ? error.message : '无法加载图片。', 'error');
      setControlsEnabled(Boolean(loaded && bounds));
    }
  } finally {
    if (requestId === loadRequestId) fileInput.value = '';
  }
}

function getDraggedValue(event: PointerEvent, key: BoundKey): number {
  if (!loaded || !bounds) return 0;
  const rect = editorCanvas.getBoundingClientRect();
  if (key === 'left' || key === 'right') {
    const raw = displayToSourcePixel(event.clientX, rect.left, rect.width, loaded.size.width);
    const { minimum, maximum } = boundRange(key);
    return clampInteger(raw, minimum, maximum);
  }
  const raw = displayToSourcePixel(event.clientY, rect.top, rect.height, loaded.size.height);
  return key === 'top'
    ? clampInteger(raw, 1, bounds.bottom)
    : clampInteger(raw, bounds.top, loaded.size.height - 1);
}

for (const key of Object.keys(guides) as BoundKey[]) {
  const guide = guides[key];
  guide.addEventListener('pointerdown', (event) => {
    if (!loaded || !bounds || guide.classList.contains('disabled') || drag) return;
    event.preventDefault();
    guide.setPointerCapture(event.pointerId);
    guide.classList.add('active');
    drag = { key, pointerId: event.pointerId, target: guide };
  });
  guide.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId || drag.key !== key || !bounds) return;
    changeBound(key, getDraggedValue(event, key));
  });
  const finishDrag = (event: PointerEvent): void => {
    if (!drag || drag.pointerId !== event.pointerId || drag.key !== key) return;
    guide.classList.remove('active');
    if (guide.hasPointerCapture(event.pointerId)) guide.releasePointerCapture(event.pointerId);
    drag = null;
  };
  guide.addEventListener('pointerup', finishDrag);
  guide.addEventListener('pointercancel', finishDrag);
  guide.addEventListener('lostpointercapture', (event) => {
    if (!drag || drag.pointerId !== event.pointerId || drag.key !== key) return;
    guide.classList.remove('active');
    drag = null;
  });
  guide.addEventListener('keydown', (event) => {
    if (!loaded || !bounds) return;
    const vertical = key === 'left' || key === 'right';
    const direction = vertical
      ? event.key === 'ArrowLeft' ? -1 : event.key === 'ArrowRight' ? 1 : 0
      : event.key === 'ArrowUp' ? -1 : event.key === 'ArrowDown' ? 1 : 0;
    if (!direction) return;
    event.preventDefault();
    changeBound(key, bounds[key] + direction);
  });
}

for (const key of Object.keys(inputs) as BoundKey[]) {
  inputs[key].addEventListener('input', () => validateDraft(key));
}

mirrorSelect.addEventListener('change', () => {
  if (!loaded || !bounds) return;
  mirrorMode = mirrorSelect.value as MirrorMode;
  if (mirrorMode !== 'none') bounds = symmetricSliceBounds(loaded.size, bounds, mirrorMode);
  drawSource();
  render();
  setStatus(mirrorMode === 'none'
    ? '已恢复原图像素。'
    : `已以${mirrorMode === 'left' ? '左' : '右'}侧为准修复左右对称，切片边距已同步。`, 'success');
});

suffixInput.addEventListener('input', () => {
  // Let users finish typing before validating; blur and export are the checkpoints.
  suffixIsValid = true;
  suffixError.textContent = '';
  suffixInput.removeAttribute('aria-invalid');
  suffixInput.setCustomValidity('');
  invalidateExport();
  setControlsEnabled(Boolean(loaded && bounds));
});
suffixInput.addEventListener('blur', validateSuffix);
suffixEnabled.addEventListener('change', () => {
  invalidateExport();
  suffixField.hidden = !suffixEnabled.checked;
  suffixInput.disabled = !suffixEnabled.checked;
  validateSuffix();
});

fileInput.addEventListener('change', () => {
  const file = fileInput.files?.[0];
  if (file) void loadFile(file);
});
document.querySelector<HTMLElement>('label[for="file-input"]')?.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter' && event.key !== ' ') return;
  event.preventDefault();
  fileInput.click();
});

for (const eventName of ['dragenter', 'dragover']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.add('drag-over');
  });
}
for (const eventName of ['dragleave', 'drop']) {
  dropZone.addEventListener(eventName, (event) => {
    event.preventDefault();
    dropZone.classList.remove('drag-over');
  });
}
dropZone.addEventListener('drop', (event) => {
  const files = event.dataTransfer?.files;
  if (!files?.length) return;
  if (files.length !== 1) {
    setStatus('每次只能拖入一个 PNG 文件。', 'error');
    return;
  }
  void loadFile(files[0]);
});
window.addEventListener('dragover', (event) => event.preventDefault());
window.addEventListener('drop', (event) => event.preventDefault());

resetButton.addEventListener('click', () => {
  if (!resetBounds) {
    setStatus('这张图片太小，无法进行九宫格裁剪。', 'error');
    return;
  }
  bounds = { ...resetBounds };
  previewViewport.reset();
  mirrorMode = 'none';
  mirrorSelect.value = mirrorMode;
  drawSource();
  if (drag) drag.target.classList.remove('active');
  drag = null;
  render();
  setStatus('切片边界和镜像设置已重置。', 'success');
});

copyButton.addEventListener('click', async () => {
  if (!loaded || !bounds || !inputIsValid) return;
  const insets = {
    left: bounds.left,
    right: loaded.size.width - bounds.right,
    top: bounds.top,
    bottom: loaded.size.height - bounds.bottom,
  };
  try {
    await navigator.clipboard.writeText(JSON.stringify(insets));
    setStatus('Cocos 边距已复制为 JSON。', 'success');
  } catch {
    setStatus(`复制失败，请手动复制这段 JSON：${JSON.stringify(insets)}`, 'error');
  }
});

function canvasToPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('浏览器无法生成 PNG，请重试。'));
    }, 'image/png');
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

function friendlyOptimizationReason(reason?: string): string {
  if (!reason) return '优化不可用，已安全回退';
  if (reason.includes('expected magic word') || reason.includes('WebAssembly.instantiate')) {
    return '无损优化组件加载失败，服务器返回了错误的 WASM 资源；已安全使用基础 PNG';
  }
  if (/fetch|network|404/i.test(reason)) {
    return '无损优化资源加载失败；已安全使用基础 PNG';
  }
  return reason;
}

function downloadPng(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

exportButton.addEventListener('click', async () => {
  if (!loaded || !bounds || !inputIsValid || exporting) return;
  if (!validateSuffix()) {
    suffixInput.focus();
    return;
  }

  const taskId = ++exportRequestId;
  const controller = new AbortController();
  exportAbortController?.abort();
  exportAbortController = controller;
  const snapshot = {
    element: mirrorMode === 'none' ? loaded.element : editorCanvas,
    size: { ...loaded.size },
    bounds: { ...bounds },
    fileName: buildExportFileName(loaded.fileName, suffixEnabled.checked, suffixInput.value, mirrorMode),
  };

  exporting = true;
  exportDetail.textContent = '';
  setControlsEnabled(true);
  setStatus('正在生成 PNG…');

  try {
    const exportCanvas = composeNineSlice(snapshot.element, snapshot.size, snapshot.bounds);
    const baseline = await canvasToPng(exportCanvas);
    if (taskId !== exportRequestId) return;

    setStatus('正在进行无损 PNG 优化…');
    const result = await optimizePng(baseline, {
      optimizer: workerOptimizer,
      timeoutMs: 30_000,
      signal: controller.signal,
    });
    if (taskId !== exportRequestId) return;

    downloadPng(result.blob, snapshot.fileName);
    if (result.usedOptimized) {
      const saved = result.originalBytes - result.optimizedBytes;
      const percent = Math.round((saved / result.originalBytes) * 100);
      exportDetail.textContent = `优化前 ${formatBytes(result.originalBytes)} → 导出 ${formatBytes(result.optimizedBytes)}，减少 ${percent}%`;
      setStatus(`已无损优化并导出 ${snapshot.fileName}。`, 'success');
    } else if (result.status === 'kept-original') {
      exportDetail.textContent = `导出 ${formatBytes(result.optimizedBytes)}；优化结果未更小，已保留基础 PNG`;
      setStatus(`已导出 ${snapshot.fileName}，当前 PNG 已无需进一步优化。`, 'success');
    } else {
      exportDetail.textContent = `导出 ${formatBytes(result.optimizedBytes)}；${friendlyOptimizationReason(result.reason)}`;
      setStatus(`优化未完成，已导出未优化的无损 PNG。`, 'success');
    }
  } catch (error) {
    if (taskId === exportRequestId) {
      setStatus(error instanceof Error ? error.message : 'PNG 导出失败，请重试。', 'error');
    }
  } finally {
    if (taskId === exportRequestId) {
      exporting = false;
      exportAbortController = null;
      setControlsEnabled(true);
    }
  }
});

window.addEventListener('beforeunload', () => {
  exportAbortController?.abort();
  if (loaded) URL.revokeObjectURL(loaded.objectUrl);
});
