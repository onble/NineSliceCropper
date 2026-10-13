import initOxiPng, { optimise } from '@jsquash/oxipng/codec/pkg/squoosh_oxipng.js';
import oxiPngWasmUrl from '@jsquash/oxipng/codec/pkg/squoosh_oxipng_bg.wasm?url';
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

/** Installs the shared worker protocol around a concrete WASM encoder. */
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

let oxiPngReady: Promise<void> | undefined;

function hasWasmMagic(bytes: Uint8Array): boolean {
  return bytes.length >= 4
    && bytes[0] === 0x00
    && bytes[1] === 0x61
    && bytes[2] === 0x73
    && bytes[3] === 0x6d;
}

/**
 * Initialise the single-threaded codec from an asset URL emitted by Vite.
 * Loading the bytes explicitly avoids the package's automatic multi-thread
 * feature detection and its deployment-sensitive internal URL resolution.
 */
function ensureOxiPng(): Promise<void> {
  if (!oxiPngReady) {
    oxiPngReady = (async () => {
      const response = await fetch(oxiPngWasmUrl);
      if (!response.ok) {
        throw new Error(`无损优化组件请求失败（HTTP ${response.status}），请确认部署包含 assets 目录中的 WASM 文件。`);
      }

      const wasmBytes = new Uint8Array(await response.arrayBuffer());
      if (!hasWasmMagic(wasmBytes)) {
        const contentType = response.headers.get('content-type') ?? '未知类型';
        throw new Error(`无损优化组件内容无效（${contentType}），服务器没有返回正确的 WASM 文件。`);
      }

      await initOxiPng(wasmBytes);
    })().catch((error: unknown) => {
      // Retry on the next export after a transient deployment/network error.
      oxiPngReady = undefined;
      throw error;
    });
  }

  return oxiPngReady;
}

installPngOptimizerWorker(async (bytes) => {
  await ensureOxiPng();
  return optimise(Uint8Array.from(bytes), 3, false, false);
});
