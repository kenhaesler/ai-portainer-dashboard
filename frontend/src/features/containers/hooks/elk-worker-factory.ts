/**
 * Creates the Web Worker that runs the ELK layout engine (#1508).
 *
 * Isolated in its own module because the `?worker` import is a Vite-specific
 * construct: Vite bundles the referenced script into a separate asset and the
 * import resolves to a Worker constructor. Keeping it here lets tests mock
 * this module wholesale (jsdom has no Worker) without touching the hook.
 */
import ElkWorker from 'elkjs/lib/elk-worker.min.js?worker';

export function createElkWorker(): Worker {
  return new ElkWorker();
}
