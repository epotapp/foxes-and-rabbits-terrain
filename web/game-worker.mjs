import { createRuntime } from './runtime.mjs';
const request = createRuntime();
self.onmessage = async ({ data: { id, path, options } }) => {
  const response = await request(path, options);
  self.postMessage({ id, ...response });
};
