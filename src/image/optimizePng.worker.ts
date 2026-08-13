import { optimise } from '@jsquash/oxipng';
import type {
  PngBytes,
  PngOptimizer,
  PngWorkerFailure,
  PngWorkerRequest,
  PngWorkerSuccess,
} from './optimizePng.js';

interface WorkerScope {
  addEventListener(
    type: 'message',
    listener: (event: MessageEvent<PngWorkerRequest>) => void,
  ): void;
  postMessage(message: PngWorkerSuccess | PngWorkerFailure, transfer?: Transferable[]): void;
}

function outputBuffer(value: PngBytes): ArrayBuffer {
  const bytes = value instanceof Uint8Array ? value : new Uint8Array(value);
  return Uint8Array.from(bytes).buffer;
}

/**
 * Installs the shared worker protocol around a concrete WASM encoder.
 *
 * The worker entry point should import its encoder and call this once:
 * `installPngOptimizerWorker((bytes) => encoder.optimize(bytes))`.
 */
export function installPngOptimizerWorker(
  optimizer: PngOptimizer,
  scope: WorkerScope = self as unknown as WorkerScope,
): void {
  scope.addEventListener('message', (event: MessageEvent<PngWorkerRequest>) => {
    const request = event.data;
    if (!request || request.type !== 'optimize-png') return;

    void Promise.resolve(optimizer(new Uint8Array(request.bytes))).then((value) => {
      const bytes = outputBuffer(value);
      const response: PngWorkerSuccess = { type: 'optimized-png', id: request.id, bytes };
      scope.postMessage(response, [bytes]);
    }).catch((error: unknown) => {
      const message = error instanceof Error && error.message ? error.message : 'PNG 优化失败。';
      const response: PngWorkerFailure = { type: 'optimize-png-error', id: request.id, message };
      scope.postMessage(response);
    });
  });
}

installPngOptimizerWorker(async (bytes) => optimise(Uint8Array.from(bytes).buffer, {
  level: 3,
  interlace: false,
  optimiseAlpha: false,
}));
