import type {
  CopyRegion,
  ImageSize,
  NineSliceRegions,
  PixelRect,
  SliceBounds,
} from '../types.js';

function assertInteger(name: string, value: number): void {
  if (!Number.isFinite(value) || !Number.isInteger(value)) {
    throw new RangeError(`${name}必须是有限整数。`);
  }
}

export function validateSliceBounds(
  image: Readonly<ImageSize>,
  bounds: Readonly<SliceBounds>,
): void {
  assertInteger('图片宽度', image.width);
  assertInteger('图片高度', image.height);
  assertInteger('左侧边界', bounds.left);
  assertInteger('右侧边界', bounds.right);
  assertInteger('上侧边界', bounds.top);
  assertInteger('下侧边界', bounds.bottom);

  if (image.width < 2 || image.height < 2) {
    throw new RangeError('图片尺寸至少需要 2 × 2 像素。');
  }
  if (bounds.left < 1 || bounds.left > bounds.right || bounds.right >= image.width) {
    throw new RangeError(`横向边界必须满足：0 < 左侧 ≤ 右侧 < ${image.width}。`);
  }
  if (bounds.top < 1 || bounds.top > bounds.bottom || bounds.bottom >= image.height) {
    throw new RangeError(`纵向边界必须满足：0 < 上侧 ≤ 下侧 < ${image.height}。`);
  }
}

/** Keep each guide at the same relative position when replacing an image. */
export function scaleSliceBounds(
  previousSize: Readonly<ImageSize>,
  nextSize: Readonly<ImageSize>,
  bounds: Readonly<SliceBounds>,
): SliceBounds {
  validateSliceBounds(previousSize, bounds);
  const scale = (value: number, previousLength: number, nextLength: number): number =>
    Math.max(1, Math.min(nextLength - 1, Math.round(value * nextLength / previousLength)));
  const result = {
    left: scale(bounds.left, previousSize.width, nextSize.width),
    right: scale(bounds.right, previousSize.width, nextSize.width),
    top: scale(bounds.top, previousSize.height, nextSize.height),
    bottom: scale(bounds.bottom, previousSize.height, nextSize.height),
  };
  validateSliceBounds(nextSize, result);
  return result;
}

function rect(x: number, y: number, width: number, height: number): PixelRect {
  return { x, y, width, height };
}

function region(source: PixelRect, x: number, y: number): CopyRegion {
  return {
    source,
    destination: rect(x, y, source.width, source.height),
  };
}

export function calculateNineSliceRegions(
  image: Readonly<ImageSize>,
  bounds: Readonly<SliceBounds>,
): NineSliceRegions {
  validateSliceBounds(image, bounds);

  const { width: sourceWidth, height: sourceHeight } = image;
  const { left, right, top, bottom } = bounds;
  const rightWidth = sourceWidth - right;
  const bottomHeight = sourceHeight - bottom;

  return {
    outputSize: {
      width: left + rightWidth,
      height: top + bottomHeight,
    },
    regions: {
      lt: region(rect(0, 0, left, top), 0, 0),
      rt: region(rect(right, 0, rightWidth, top), left, 0),
      lb: region(rect(0, bottom, left, bottomHeight), 0, top),
      rb: region(rect(right, bottom, rightWidth, bottomHeight), left, top),
    },
  };
}

export function composeNineSlice(
  source: CanvasImageSource,
  image: Readonly<ImageSize>,
  bounds: Readonly<SliceBounds>,
  target = document.createElement('canvas'),
): HTMLCanvasElement {
  const result = calculateNineSliceRegions(image, bounds);
  target.width = result.outputSize.width;
  target.height = result.outputSize.height;

  // Keep translucent pixel rounding consistent across previews, resets and exports.
  const context = target.getContext('2d', { willReadFrequently: true });
  if (!context) {
    throw new Error('当前浏览器无法创建 2D 画布。');
  }

  context.setTransform(1, 0, 0, 1, 0, 0);
  context.clearRect(0, 0, target.width, target.height);
  context.globalAlpha = 1;
  context.globalCompositeOperation = 'source-over';
  context.imageSmoothingEnabled = false;

  for (const copy of Object.values(result.regions)) {
    const src = copy.source;
    const dst = copy.destination;
    context.drawImage(
      source,
      src.x,
      src.y,
      src.width,
      src.height,
      dst.x,
      dst.y,
      src.width,
      src.height,
    );
  }

  return target;
}
