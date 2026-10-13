import type { ImageSize, SliceBounds } from '../types.js';
import { validateSliceBounds } from './cropNineSlice.js';

/** The side to preserve when making an image horizontally symmetrical. */
export type MirrorMode = 'none' | 'left' | 'right';

export function symmetricSliceBounds(
  image: Readonly<ImageSize>,
  bounds: Readonly<SliceBounds>,
  sourceSide: Exclude<MirrorMode, 'none'>,
): SliceBounds {
  validateSliceBounds(image, bounds);
  const selectedInset = sourceSide === 'left' ? bounds.left : image.width - bounds.right;
  const inset = Math.max(1, Math.min(Math.floor(image.width / 2), selectedInset));
  return { ...bounds, left: inset, right: image.width - inset };
}

export function composeHorizontalMirror(
  source: CanvasImageSource,
  image: Readonly<ImageSize>,
  mode: MirrorMode,
  target = document.createElement('canvas'),
): HTMLCanvasElement {
  if (!Number.isInteger(image.width) || !Number.isInteger(image.height)
    || image.width < 1 || image.height < 1) {
    throw new RangeError('图片宽度和高度必须是正整数。');
  }
  if (source === target) {
    throw new Error('镜像画布不能与原图使用同一画布。');
  }

  target.width = image.width;
  target.height = image.height;
  // Avoid GPU/CPU readback switching, which can change translucent RGB rounding.
  const context = target.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('当前浏览器无法创建 2D 画布。');
  }
  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, image.width, image.height);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.imageSmoothingEnabled = false;

  // Keep the initial decode identical in every mode. Cropped or transformed draws
  // can round semitransparent texture colors differently in the browser.
  context.drawImage(source, 0, 0, image.width, image.height, 0, 0, image.width, image.height);
  const halfWidth = Math.floor(image.width / 2);
  if (mode === 'none' || halfWidth === 0) return target;

  const imageData = context.getImageData(0, 0, image.width, image.height);
  const pixels = new Uint32Array(imageData.data.buffer, imageData.data.byteOffset, imageData.data.length / 4);
  for (let y = 0; y < image.height; y += 1) {
    const row = y * image.width;
    for (let x = 0; x < halfWidth; x += 1) {
      const left = row + x;
      const right = row + image.width - 1 - x;
      // Copy all four channels together; leave the selected half and odd center intact.
      if (mode === 'left') pixels[right] = pixels[left];
      else pixels[left] = pixels[right];
    }
  }
  // Restrict the write to the destination half, keeping source pixels out of a
  // second premultiplied-alpha conversion in the browser's backing store.
  const destinationX = mode === 'left' ? image.width - halfWidth : 0;
  context.putImageData(imageData, 0, 0, destinationX, 0, halfWidth, image.height);
  return target;
}
