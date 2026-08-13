import { optimizePng } from '../src/image/optimizePng.js';

let passed = 0;

function pngBytes(length: number, width = 16, height = 12): Uint8Array {
  const bytes = new Uint8Array(Math.max(24, length));
  bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
  const view = new DataView(bytes.buffer);
  view.setUint32(16, width);
  view.setUint32(20, height);
  return bytes;
}

function assert(condition: boolean, label: string): void {
  if (!condition) throw new Error(label);
  passed += 1;
}

const smaller = await optimizePng(pngBytes(80), { optimizer: async () => pngBytes(40) });
assert(smaller.usedOptimized, '严格更小的 PNG 应被采用');
assert(smaller.blob.size === 40 && smaller.optimizedBytes === 40, '返回体积应等于选中的优化结果');

const larger = await optimizePng(pngBytes(40), { optimizer: async () => pngBytes(60) });
assert(!larger.usedOptimized && larger.blob.size === 40, '更大的候选结果必须被拒绝');
assert(larger.candidateBytes === 60, '应记录被拒绝的候选体积');

const equal = await optimizePng(pngBytes(40), { optimizer: async () => pngBytes(40) });
assert(!equal.usedOptimized && equal.status === 'kept-original', '相同体积时必须保留基线 PNG');

const changedDimensions = await optimizePng(pngBytes(80), { optimizer: async () => pngBytes(40, 8, 6) });
assert(changedDimensions.status === 'failed' && changedDimensions.blob.size === 80, '尺寸变化必须安全回退');

const invalid = await optimizePng(pngBytes(80), { optimizer: async () => new Uint8Array(20) });
assert(invalid.status === 'failed' && invalid.blob.size === 80, '无效 PNG 必须安全回退');

const failed = await optimizePng(pngBytes(80), {
  optimizer: async () => { throw new Error('boom'); },
});
assert(failed.status === 'failed' && failed.blob.size === 80, '优化异常必须安全回退');

const timedOut = await optimizePng(pngBytes(80), {
  optimizer: () => new Promise(() => undefined),
  timeoutMs: 5,
});
assert(timedOut.status === 'timed-out' && timedOut.blob.size === 80, '优化超时必须安全回退');

const controller = new AbortController();
controller.abort();
const aborted = await optimizePng(pngBytes(80), {
  optimizer: async () => pngBytes(40),
  signal: controller.signal,
});
assert(aborted.status === 'aborted' && aborted.blob.size === 80, '取消必须安全回退');

console.log(`PNG optimizer tests passed: ${passed}`);
