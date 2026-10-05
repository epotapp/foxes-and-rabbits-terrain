import { createRuntime } from './runtime.mjs';
import { runBatch } from './batch.mjs';
const request = createRuntime(runBatch);
self.onmessage = async ({ data: { id, path, options } }) => {
  const response = await request(path, options);
  self.postMessage({ id, ...response });
};
