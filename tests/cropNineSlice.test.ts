import {
  calculateNineSliceRegions,
  composeNineSlice,
  scaleSliceBounds,
  validateSliceBounds,
} from '../src/image/cropNineSlice.js';
import { clampInteger, displayToSourcePixel } from '../src/editor/coordinate.js';

let passed = 0;

function equal(actual: unknown, expected: unknown, label: string): void {
  const actualJson = JSON.stringify(actual);
  const expectedJson = JSON.stringify(expected);
  if (actualJson !== expectedJson) {
    throw new Error(`${label}\nExpected: ${expectedJson}\nActual:   ${actualJson}`);
  }
  passed += 1;
}

function rejects(callback: () => void, label: string): void {
  try {
    callback();
  } catch (error) {
    if (error instanceof RangeError) {
      passed += 1;
      return;
    }
    throw error;
  }
  throw new Error(`${label}: expected a RangeError.`);
}

const canonical = calculateNineSliceRegions(
  { width: 100, height: 100 },
  { left: 10, right: 90, top: 20, bottom: 80 },
);
equal(canonical.outputSize, { width: 20, height: 40 }, 'Canonical output size');
equal(canonical.regions.lt, {
  source: { x: 0, y: 0, width: 10, height: 20 },
  destination: { x: 0, y: 0, width: 10, height: 20 },
}, 'LT region');
equal(canonical.regions.rt, {
  source: { x: 90, y: 0, width: 10, height: 20 },
  destination: { x: 10, y: 0, width: 10, height: 20 },
}, 'RT region');
equal(canonical.regions.lb, {
  source: { x: 0, y: 80, width: 10, height: 20 },
  destination: { x: 0, y: 20, width: 10, height: 20 },
}, 'LB region');
equal(canonical.regions.rb, {
  source: { x: 90, y: 80, width: 10, height: 20 },
  destination: { x: 10, y: 20, width: 10, height: 20 },
}, 'RB region');

equal(
  calculateNineSliceRegions(
    { width: 17, height: 11 },
    { left: 3, right: 12, top: 2, bottom: 8 },
  ).outputSize,
  { width: 8, height: 5 },
  'Asymmetric output size',
);

const minimum = calculateNineSliceRegions(
  { width: 2, height: 2 },
  { left: 1, right: 1, top: 1, bottom: 1 },
);
equal(minimum.outputSize, { width: 2, height: 2 }, '2 × 2 minimum is valid');

equal(displayToSourcePixel(110, 10, 960, 1920), 200, 'Display maps to source pixels');
equal(displayToSourcePixel(176.5, 10, 333, 1000), 500, 'Coordinate mapping rounds once');
equal(clampInteger(10.7, 1, 10), 10, 'Clamp rounds and applies maximum');

const previousBounds = { left: 30, right: 60, top: 40, bottom: 160 };
equal(
  scaleSliceBounds({ width: 100, height: 200 }, { width: 100, height: 200 }, previousBounds),
  previousBounds,
  'Same-size replacement preserves all coordinates',
);
equal(
  scaleSliceBounds({ width: 100, height: 200 }, { width: 200, height: 100 }, previousBounds),
  { left: 60, right: 120, top: 20, bottom: 80 },
  'Width and height scale independently, including right/bottom coordinates',
);
equal(
  scaleSliceBounds({ width: 100, height: 200 }, { width: 100, height: 100 }, previousBounds),
  { left: 30, right: 60, top: 20, bottom: 80 },
  'Changing only height preserves horizontal coordinates',
);
equal(
  scaleSliceBounds({ width: 100, height: 200 }, { width: 7, height: 9 }, previousBounds),
  { left: 2, right: 4, top: 2, bottom: 7 },
  'Fractional coordinates round to nearest pixel',
);
equal(
  scaleSliceBounds({ width: 100, height: 100 }, { width: 2, height: 2 },
    { left: 1, right: 99, top: 1, bottom: 99 }),
  { left: 1, right: 1, top: 1, bottom: 1 },
  'Downscaling keeps all four corners nonempty at minimum size',
);
equal(
  scaleSliceBounds({ width: 100, height: 100 }, { width: 51, height: 51 },
    { left: 30, right: 30, top: 60, bottom: 60 }),
  { left: 15, right: 15, top: 31, bottom: 31 },
  'Coincident guides remain coincident',
);
rejects(
  () => scaleSliceBounds({ width: 100, height: 200 }, { width: 1, height: 2 }, previousBounds),
  'Replacement must support four nonempty corners',
);

const drawCalls: unknown[][] = [];
const mockContext = {
  globalAlpha: 0,
  globalCompositeOperation: '',
  imageSmoothingEnabled: true,
  setTransform: (..._arguments: unknown[]) => undefined,
  clearRect: (..._arguments: unknown[]) => undefined,
  drawImage: (...arguments_: unknown[]) => drawCalls.push(arguments_),
};
const mockCanvas = {
  width: 0,
  height: 0,
  getContext: () => mockContext,
} as unknown as HTMLCanvasElement;
composeNineSlice(
  {} as CanvasImageSource,
  { width: 5, height: 4 },
  { left: 1, right: 4, top: 1, bottom: 3 },
  mockCanvas,
);
equal({ width: mockCanvas.width, height: mockCanvas.height }, { width: 2, height: 2 }, 'Compose bitmap size');
equal(drawCalls.length, 4, 'Compose uses exactly four draw calls');
equal(
  drawCalls.map((call) => call.slice(1)),
  [
    [0, 0, 1, 1, 0, 0, 1, 1],
    [4, 0, 1, 1, 1, 0, 1, 1],
    [0, 3, 1, 1, 0, 1, 1, 1],
    [4, 3, 1, 1, 1, 1, 1, 1],
  ],
  'Compose preserves corner pixels without scaling',
);
equal(mockContext.imageSmoothingEnabled, false, 'Compose disables smoothing');

rejects(
  () => validateSliceBounds(
    { width: 1, height: 1 },
    { left: 0, right: 0, top: 0, bottom: 0 },
  ),
  '1 × 1 image',
);
rejects(
  () => validateSliceBounds(
    { width: 100, height: 100 },
    { left: 0, right: 90, top: 20, bottom: 80 },
  ),
  'Empty left corners',
);
rejects(
  () => validateSliceBounds(
    { width: 100, height: 100 },
    { left: 91, right: 90, top: 20, bottom: 80 },
  ),
  'Crossed horizontal bounds',
);
rejects(
  () => validateSliceBounds(
    { width: 100, height: 100 },
    { left: 10, right: 90, top: 81, bottom: 80 },
  ),
  'Crossed vertical bounds',
);
rejects(
  () => validateSliceBounds(
    { width: 100, height: 100 },
    { left: 10.5, right: 90, top: 20, bottom: 80 },
  ),
  'Fractional bounds',
);
rejects(
  () => validateSliceBounds(
    { width: Number.NaN, height: 100 },
    { left: 10, right: 90, top: 20, bottom: 80 },
  ),
  'Non-finite dimensions',
);

console.log(`Core algorithm tests passed: ${passed}`);
