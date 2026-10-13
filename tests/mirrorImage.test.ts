import { composeHorizontalMirror, symmetricSliceBounds } from '../src/image/mirrorImage.js';
import type { MirrorMode } from '../src/image/mirrorImage.js';

let passed = 0;
function equal(actual: unknown, expected: unknown, label: string): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`${label}\nExpected: ${JSON.stringify(expected)}\nActual: ${JSON.stringify(actual)}`);
  }
  passed += 1;
}
function rejects(callback: () => unknown, label: string): void {
  try {
    callback();
  } catch (error) {
    if (error instanceof RangeError) {
      passed += 1;
      return;
    }
    throw error;
  }
  throw new Error(`${label}: expected RangeError`);
}

type Pixel = readonly [number, number, number, number];
interface Raster {
  width: number;
  height: number;
  pixels: Pixel[];
}
const clear: Pixel = [0, 0, 0, 0];
const red: Pixel = [255, 0, 0, 255];
const green: Pixel = [0, 255, 0, 128];
const blue: Pixel = [0, 0, 255, 255];
const yellow: Pixel = [255, 255, 0, 64];
const purple: Pixel = [128, 0, 128, 255];

// A small pixel rasterizer exercises the drawing result, including source-over alpha.
// The browser's Canvas implementation is still covered by manual/browser verification.
function canvasRaster(width: number, height: number) {
  const raster: Raster = { width, height, pixels: Array(width * height).fill(purple) };
  let transform = [1, 0, 0, 1, 0, 0];
  const drawRegions: number[][] = [];
  const writeRegions: number[][] = [];
  const context = {
    globalAlpha: 0.5,
    globalCompositeOperation: 'multiply',
    imageSmoothingEnabled: true,
    setTransform: (...values: number[]) => { transform = values; },
    clearRect: (x: number, y: number, w: number, h: number) => {
      for (let row = y; row < y + h; row += 1) {
        for (let col = x; col < x + w; col += 1) raster.pixels[row * raster.width + col] = clear;
      }
    },
    drawImage: (source: Raster, sx: number, sy: number, sw: number, sh: number,
      dx: number, dy: number, dw: number, dh: number) => {
      drawRegions.push([sx, sy, sw, sh, dx, dy, dw, dh]);
      if (sw !== dw || sh !== dh) throw new Error('Unexpected image resampling');
      if (context.globalCompositeOperation !== 'source-over') throw new Error('Unexpected composite');
      for (let y = 0; y < sh; y += 1) {
        for (let x = 0; x < sw; x += 1) {
          const [a, b, c, d, e, f] = transform;
          const targetX = Math.floor(a * (dx + x + 0.5) + c * (dy + y + 0.5) + e);
          const targetY = Math.floor(b * (dx + x + 0.5) + d * (dy + y + 0.5) + f);
          if (targetX < 0 || targetX >= raster.width || targetY < 0 || targetY >= raster.height) {
            throw new Error('Draw outside target');
          }
          const index = targetY * raster.width + targetX;
          const src = source.pixels[(sy + y) * source.width + sx + x];
          const dst = raster.pixels[index];
          const srcAlpha = src[3] / 255 * context.globalAlpha;
          const dstAlpha = dst[3] / 255 * (1 - srcAlpha);
          const alpha = srcAlpha + dstAlpha;
          raster.pixels[index] = alpha === 0 ? clear : [
            Math.round((src[0] * srcAlpha + dst[0] * dstAlpha) / alpha),
            Math.round((src[1] * srcAlpha + dst[1] * dstAlpha) / alpha),
            Math.round((src[2] * srcAlpha + dst[2] * dstAlpha) / alpha),
            Math.round(alpha * 255),
          ];
        }
      }
    },
    getImageData: (x: number, y: number, w: number, h: number) => {
      const data = new Uint8ClampedArray(w * h * 4);
      for (let row = 0; row < h; row += 1) {
        for (let col = 0; col < w; col += 1) {
          data.set(raster.pixels[(y + row) * raster.width + x + col], (row * w + col) * 4);
        }
      }
      return { data, width: w, height: h };
    },
    putImageData: (imageData: { data: Uint8ClampedArray; width: number; height: number }, x: number, y: number,
      dirtyX = 0, dirtyY = 0, dirtyWidth = imageData.width, dirtyHeight = imageData.height) => {
      writeRegions.push([dirtyX, dirtyY, dirtyWidth, dirtyHeight]);
      for (let row = dirtyY; row < dirtyY + dirtyHeight; row += 1) {
        for (let col = dirtyX; col < dirtyX + dirtyWidth; col += 1) {
          const offset = (row * imageData.width + col) * 4;
          raster.pixels[(y + row) * raster.width + x + col] = [imageData.data[offset],
            imageData.data[offset + 1], imageData.data[offset + 2], imageData.data[offset + 3]];
        }
      }
    },
  };
  const target = Object.assign(raster, { getContext: () => context });
  return { target: target as unknown as HTMLCanvasElement, raster, context, drawRegions, writeRegions,
    transform: () => transform };
}

function checkPixels(rows: Pixel[][], mode: MirrorMode, expected: Pixel[][], label: string): void {
  const source = { width: rows[0].length, height: rows.length, pixels: rows.flat() };
  const before = JSON.stringify(source);
  const test = canvasRaster(source.width, source.height);
  const result = composeHorizontalMirror(source as unknown as CanvasImageSource, source, mode, test.target);
  equal(result === test.target, true, `${label}: provided target reused`);
  equal([result.width, result.height], [source.width, source.height], `${label}: dimensions unchanged`);
  equal(test.raster.pixels, expected.flat(), `${label}: pixel colors and alpha`);
  equal(JSON.stringify(source), before, `${label}: original retained`);
  equal(test.context.imageSmoothingEnabled, false, `${label}: smoothing disabled`);
  equal(test.transform(), [1, 0, 0, 1, 0, 0], `${label}: transform restored`);
  equal(test.drawRegions, [[0, 0, source.width, source.height, 0, 0, source.width, source.height]],
    `${label}: single complete source draw avoids browser texture rounding differences`);
  const halfWidth = Math.floor(source.width / 2);
  equal(test.writeRegions, mode === 'none' || halfWidth === 0 ? []
    : [[mode === 'left' ? source.width - halfWidth : 0, 0, halfWidth, source.height]],
  `${label}: pixel write leaves source half and odd center untouched`);
}

checkPixels([[red, green, blue, yellow], [clear, blue, green, red]], 'left',
  [[red, green, green, red], [clear, blue, blue, clear]], 'Even width, preserve left');
checkPixels([[red, green, blue, yellow], [clear, blue, green, red]], 'right',
  [[yellow, blue, blue, yellow], [red, green, green, red]], 'Even width, preserve right');
checkPixels([[red, green, purple, blue, yellow], [clear, yellow, blue, red, green]], 'left',
  [[red, green, purple, green, red], [clear, yellow, blue, yellow, clear]], 'Odd width, preserve left and center');
checkPixels([[red, green, purple, blue, yellow], [clear, yellow, blue, red, green]], 'right',
  [[yellow, blue, purple, blue, yellow], [green, red, blue, red, green]], 'Odd width, preserve right and center');
checkPixels([[red, clear], [green, yellow]], 'none', [[red, clear], [green, yellow]], 'No mirror restores original');
checkPixels([[red, blue], [green, clear]], 'left', [[red, red], [green, green]], 'Minimum nine-slice size');
checkPixels([[green]], 'right', [[green]], 'Single center column');
const softEdge: Pixel = [206, 193, 171, 204];
checkPixels([[softEdge, green, blue, clear]], 'left', [[softEdge, green, green, softEdge]],
  'Semitransparent artwork edge retains exact RGBA');

const switchSource: Raster = { width: 4, height: 2,
  pixels: [red, green, blue, clear, yellow, clear, green, red] };
const switchTarget = canvasRaster(4, 2);
for (const mode of ['left', 'right', 'none'] as const) {
  composeHorizontalMirror(switchSource as unknown as CanvasImageSource, switchSource, mode, switchTarget.target);
  const expected = mode === 'left' ? [red, green, green, red, yellow, clear, clear, yellow]
    : mode === 'right' ? [clear, blue, blue, clear, red, green, green, red]
      : switchSource.pixels;
  equal(switchTarget.raster.pixels, expected, `Reusing target clears previous ${mode} result, including alpha`);
}

const size = { width: 147, height: 30 };
const bounds = Object.freeze({ left: 8, right: 136, top: 3, bottom: 26 });
equal(symmetricSliceBounds(size, bounds, 'left'), { left: 8, right: 139, top: 3, bottom: 26 }, 'Use left inset');
equal(symmetricSliceBounds(size, bounds, 'right'), { left: 11, right: 136, top: 3, bottom: 26 }, 'Use right inset');
equal(bounds, { left: 8, right: 136, top: 3, bottom: 26 }, 'Bounds are not mutated');
equal(symmetricSliceBounds({ width: 10, height: 2 }, { left: 8, right: 9, top: 1, bottom: 1 }, 'left'),
  { left: 5, right: 5, top: 1, bottom: 1 }, 'Thick left inset clamps to even center');
equal(symmetricSliceBounds({ width: 9, height: 2 }, { left: 1, right: 2, top: 1, bottom: 1 }, 'right'),
  { left: 4, right: 5, top: 1, bottom: 1 }, 'Thick right inset preserves odd center');
equal(symmetricSliceBounds({ width: 2, height: 2 }, { left: 1, right: 1, top: 1, bottom: 1 }, 'right'),
  { left: 1, right: 1, top: 1, bottom: 1 }, 'Minimum slice dimensions');
rejects(() => symmetricSliceBounds({ width: 1, height: 30 }, bounds, 'left'), 'Too narrow for nine-slice');
rejects(() => symmetricSliceBounds(size, { ...bounds, left: 0 }, 'left'), 'Empty source inset');
rejects(() => symmetricSliceBounds(size, { ...bounds, top: 27 }, 'right'), 'Crossed vertical bounds');
rejects(() => symmetricSliceBounds(size, { ...bounds, right: 135.5 }, 'right'), 'Fractional bounds');
rejects(() => composeHorizontalMirror({} as CanvasImageSource, { width: NaN, height: 2 }, 'left', canvasRaster(2, 2).target),
  'Invalid image size');

console.log(`Horizontal mirror tests passed: ${passed}`);
