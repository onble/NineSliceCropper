export type PngBytes = Uint8Array | ArrayBuffer;

export type PngOptimizer = (
  png: Uint8Array,
  signal?: AbortSignal,
) => PngBytes | Promise<PngBytes>;

export type PngOptimizationStatus =
  | 'optimized'
  | 'kept-original'
  | 'failed'
  | 'timed-out'
  | 'aborted';

export interface OptimizePngOptions {
  /**
   * A lossless encoder. It receives a private copy of the source bytes, so a
   * WASM implementation may safely transfer or mutate its input buffer.
   */
  optimizer: PngOptimizer;
  /** Maximum time spent in the optimizer before falling back to the source. */
  timeoutMs?: number;
  /** Cancelling is a safe fallback and never rejects the export operation. */
  signal?: AbortSignal;
}

export interface OptimizePngResult {
  /** The smaller PNG, or the byte-for-byte original when optimization is not useful. */
  blob: Blob;
  originalBytes: number;
  /** Size of the selected output; always equal to blob.size. */
  optimizedBytes: number;
  /** Encoder result size when it was rejected for being no smaller. */
  candidateBytes?: number;
  usedOptimized: boolean;
  durationMs: number;
  status: PngOptimizationStatus;
  /** A display-safe diagnostic. Present only for a failed/timed-out/aborted run. */
  reason?: string;
}

export interface PngWorkerRequest {
  type: 'optimize-png';
  id: number;
  bytes: ArrayBuffer;
}

export interface PngWorkerSuccess {
  type: 'optimized-png';
  id: number;
  bytes: ArrayBuffer;
}

export interface PngWorkerFailure {
  type: 'optimize-png-error';
  id: number;
  message: string;
}

export type PngWorkerResponse = PngWorkerSuccess | PngWorkerFailure;

const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);
const DEFAULT_TIMEOUT_MS = 30_000;
let workerRequestId = 0;

function now(): number {
  return typeof performance === 'undefined' ? Date.now() : performance.now();
}

function errorMessage(error: unknown): string {
  return error instanceof Error && error.message ? error.message : 'PNG 优化失败。';
}

function isPng(bytes: Uint8Array): boolean {
  return bytes.length >= PNG_SIGNATURE.length
    && PNG_SIGNATURE.every((value, index) => bytes[index] === value);
}

function pngDimensions(bytes: Uint8Array): string | null {
  if (!isPng(bytes) || bytes.length < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return `${view.getUint32(16)}x${view.getUint32(20)}`;
}

function asUint8Array(value: PngBytes): Uint8Array {
  return value instanceof Uint8Array ? value : new Uint8Array(value);
}

async function readInput(input: Blob | Uint8Array): Promise<Uint8Array> {
  if (input instanceof Uint8Array) return Uint8Array.from(input);
  return new Uint8Array(await input.arrayBuffer());
}

function pngBlob(bytes: Uint8Array): Blob {
  // Uint8Array.from guarantees an ArrayBuffer-backed view accepted by BlobPart
  // even when the caller supplied a SharedArrayBuffer-backed typed array.
  return new Blob([Uint8Array.from(bytes)], { type: 'image/png' });
}

function fallbackResult(
  original: Uint8Array,
  startedAt: number,
  status: Exclude<PngOptimizationStatus, 'optimized' | 'kept-original'>,
  reason: string,
): OptimizePngResult {
  return {
    blob: pngBlob(original),
    originalBytes: original.byteLength,
    optimizedBytes: original.byteLength,
    usedOptimized: false,
    durationMs: Math.max(0, now() - startedAt),
    status,
    reason,
  };
}

/**
 * Runs a lossless optimizer without making export reliability depend on it.
 * The optimized output is selected only when it is a valid PNG and strictly
 * smaller than the source. All other outcomes preserve the original bytes.
 */
export async function optimizePng(
  input: Blob | Uint8Array,
  options: Readonly<OptimizePngOptions>,
): Promise<OptimizePngResult> {
  const startedAt = now();
  const original = await readInput(input);
  const originalDimensions = pngDimensions(original);
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  if (!originalDimensions) {
    return fallbackResult(original, startedAt, 'failed', '输入内容不是有效的 PNG。');
  }

  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    return fallbackResult(original, startedAt, 'failed', 'PNG 优化超时时间必须是正数。');
  }
  if (options.signal?.aborted) {
    return fallbackResult(original, startedAt, 'aborted', 'PNG 优化已取消。');
  }

  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  let abortHandler: (() => void) | undefined;
  const runController = new AbortController();

  const timeout = new Promise<never>((_, reject) => {
    timeoutId = setTimeout(() => {
      reject(new PngOptimizationTimeoutError());
      runController.abort();
    }, timeoutMs);
  });
  const aborted = new Promise<never>((_, reject) => {
    if (!options.signal) return;
    abortHandler = () => {
      reject(new PngOptimizationAbortError());
      runController.abort();
    };
    options.signal.addEventListener('abort', abortHandler, { once: true });
  });

  try {
    // Protect the fallback copy from optimizers that mutate or transfer input.
    const optimization = Promise.resolve(
      options.optimizer(Uint8Array.from(original), runController.signal),
    );
    const output = asUint8Array(await Promise.race([optimization, timeout, aborted]));
    if (!isPng(output)) throw new Error('优化器返回的内容不是有效的 PNG。');
    if (pngDimensions(output) !== originalDimensions) {
      throw new Error('优化结果的图片尺寸发生了变化，已保留原始 PNG。');
    }

    const useOutput = output.byteLength < original.byteLength;
    const selected = useOutput ? output : original;
    return {
      blob: pngBlob(selected),
      originalBytes: original.byteLength,
      optimizedBytes: selected.byteLength,
      candidateBytes: useOutput ? undefined : output.byteLength,
      usedOptimized: useOutput,
      durationMs: Math.max(0, now() - startedAt),
      status: useOutput ? 'optimized' : 'kept-original',
    };
  } catch (error) {
    if (error instanceof PngOptimizationTimeoutError) {
      return fallbackResult(original, startedAt, 'timed-out', error.message);
    }
    if (error instanceof PngOptimizationAbortError) {
      return fallbackResult(original, startedAt, 'aborted', error.message);
    }
    return fallbackResult(original, startedAt, 'failed', errorMessage(error));
  } finally {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    if (abortHandler) options.signal?.removeEventListener('abort', abortHandler);
  }
}

class PngOptimizationTimeoutError extends Error {
  constructor() {
    super('PNG 优化超时，已使用原始文件。');
    this.name = 'PngOptimizationTimeoutError';
  }
}

class PngOptimizationAbortError extends Error {
  constructor() {
    super('PNG 优化已取消。');
    this.name = 'PngOptimizationAbortError';
  }
}

/**
 * Adapts a dedicated Web Worker to PngOptimizer. A fresh worker is used for
 * every run so timeout/cancellation can terminate expensive WASM work cleanly.
 */
export function createWorkerPngOptimizer(workerFactory: () => Worker): PngOptimizer {
  return (png, signal) => new Promise<Uint8Array>((resolve, reject) => {
    if (signal?.aborted) {
      reject(new PngOptimizationAbortError());
      return;
    }
    const worker = workerFactory();
    const id = ++workerRequestId;
    let settled = false;

    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal?.removeEventListener('abort', handleAbort);
      worker.terminate();
      callback();
    };
    const handleAbort = (): void => {
      finish(() => reject(new PngOptimizationAbortError()));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    worker.addEventListener('message', (event: MessageEvent<PngWorkerResponse>) => {
      const message = event.data;
      if (!message || message.id !== id) return;
      if (message.type === 'optimized-png') {
        finish(() => resolve(new Uint8Array(message.bytes)));
      } else if (message.type === 'optimize-png-error') {
        finish(() => reject(new Error(message.message)));
      }
    });
    worker.addEventListener('error', (event) => {
      finish(() => reject(new Error(event.message || 'PNG 优化 Worker 运行失败。')));
    });
    worker.addEventListener('messageerror', () => {
      finish(() => reject(new Error('PNG 优化 Worker 返回了无法读取的数据。')));
    });

    const bytes = Uint8Array.from(png).buffer;
    const request: PngWorkerRequest = { type: 'optimize-png', id, bytes };
    try {
      worker.postMessage(request, [bytes]);
    } catch (error) {
      finish(() => reject(error));
    }
  });
}
