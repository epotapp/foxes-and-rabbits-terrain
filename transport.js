const worker = new Worker(new URL('./web/game-worker.mjs', import.meta.url), { type: 'module' });
const pending = new Map(), downloads = new Set();
let sequence = 0, failure = null;
worker.onmessage = ({ data: { id, status, data } }) => {
  const call = pending.get(id); if (!call) return; pending.delete(id); call.cleanup();
  if (data?.filename && data.contents !== undefined) {
    const { contents, mime, ...saved } = data;
    const downloadUrl = URL.createObjectURL(new Blob([contents], { type: mime })); downloads.add(downloadUrl);
    call.resolve(Response.json({ ...saved, downloadUrl }, { status }));
  } else call.resolve(Response.json(data, { status }));
};
worker.onerror = event => {
  failure = new Error(event.message || 'The game could not load. Reload this page to try again.');
  for (const call of pending.values()) { call.cleanup(); call.reject(failure); } pending.clear();
};
window.addEventListener('pagehide', event => {
  if (event.persisted) return;
  worker.terminate(); for (const url of downloads) URL.revokeObjectURL(url);
});
export function gameFetch(path, options = {}) {
  if (failure) return Promise.reject(failure);
  if (options.signal?.aborted) return Promise.reject(new DOMException('Request cancelled.', 'AbortError'));
  return new Promise((resolve, reject) => {
    const id = ++sequence, { signal, ...request } = options;
    const abort = () => { pending.delete(id); reject(new DOMException('Request cancelled.', 'AbortError')); };
    pending.set(id, { resolve, reject, cleanup: () => signal?.removeEventListener('abort', abort) });
    signal?.addEventListener('abort', abort, { once: true });
    worker.postMessage({ id, path, options: request });
  });
}
