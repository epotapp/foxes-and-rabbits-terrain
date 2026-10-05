import { play, emptyStats, accumulate } from '../core/simulation.js';
self.onmessage = ({ data: { config, fox, rabbit, seed, start, end } }) => {
  const stats = emptyStats(config.rounds); let lastSent = performance.now();
  for (let i = start; i < end; i++) {
    const gameSeed = `${seed}:${i}`;
    try { accumulate(stats, play(gameSeed, config, fox, rabbit), gameSeed, fox, rabbit); }
    catch (error) { stats.failed++; if (stats.errors.length < 5) stats.errors.push({ seed: gameSeed, error: error.message }); }
    if (performance.now() - lastSent > 400) { self.postMessage({ type: 'progress', stats }); lastSent = performance.now(); }
  }
  self.postMessage({ type: 'done', stats });
};
