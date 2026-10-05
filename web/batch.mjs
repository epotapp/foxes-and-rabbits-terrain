import { configOf } from '../core/engine.js';
import { POLICIES } from '../core/agents.js';
import { normalizeRabbit } from '../rabbit-strategies.js';
import { emptyStats, summarize } from '../core/simulation.js';

export function runBatch(input = {}, onProgress = () => {}) {
  const config = configOf(input.config), games = Number(input.games ?? 10000);
  if (!Number.isInteger(games) || games < 1 || games > 100000) throw new Error('Choose between 1 and 100,000 games.');
  const fox = input.fox ?? 'tracker', rabbit = normalizeRabbit(input.rabbit ?? 'mixed');
  if (!POLICIES.fox.some(x => x.id === fox)) throw new Error('Choose a valid strategy for each role.');
  const maxWorkers = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));
  const requested = Number(input.workers ?? maxWorkers);
  if (!Number.isInteger(requested) || requested < 1 || requested > 32) throw new Error('Use 1–32 workers.');
  const count = Math.min(games, requested, maxWorkers), seed = String(input.seed ?? 'woodland-batch').slice(0, 100);
  const started = performance.now(), partial = Array.from({ length: count }, () => emptyStats(config.rounds)), workers = [];
  let stopped = false, finished = 0, settle;
  const promise = new Promise(resolve => { settle = resolve; });
  const snapshot = () => {
    const all = emptyStats(config.rounds);
    for (const s of partial) {
      for (const key of ['games', 'foxWins', 'rabbitWins', 'failed', 'totalRounds', 'totalActions', 'totalEdges', 'skippedTunnels', 'collapsedEdges', 'trappedGames', 'sightings', 'sightingRounds']) all[key] += s[key];
      s.captureRounds.forEach((n, i) => { all.captureRounds[i] += n; });
      all.errors.push(...s.errors); all.samples.push(...s.samples);
    }
    all.errors = all.errors.slice(0, 10); all.samples = all.samples.slice(0, 8);
    return { ...summarize(all, performance.now() - started, config, fox, rabbit, seed, count), requestedGames: games,
      status: stopped ? 'cancelled' : finished === count ? 'complete' : 'running',
      hardware: { cpu: 'Browser Web Workers', logicalCores: navigator.hardwareConcurrency || 2, node: 'Browser' }, logging: 'aggregate statistics and deterministic sample seeds' };
  };
  const cleanup = () => workers.forEach(w => w.terminate());
  try {
    for (let i = 0; i < count; i++) {
      const worker = new Worker(new URL('./batch-worker.mjs', import.meta.url), { type: 'module' }); workers.push(worker);
      let done = false;
      const finish = () => { if (done) return; done = true; finished++; worker.terminate(); const result = snapshot(); onProgress(result); if (finished === count) settle(result); };
      worker.onmessage = ({ data }) => { if (stopped || done) return; partial[i] = data.stats; if (data.type === 'done') finish(); else onProgress(snapshot()); };
      worker.onerror = error => {
        error.preventDefault(); if (stopped || done) return;
        const assigned = Math.floor(games * (i + 1) / count) - Math.floor(games * i / count);
        partial[i].failed += assigned - partial[i].games - partial[i].failed;
        partial[i].errors.push({ error: error.message || 'Playtest worker failed.' }); finish();
      };
      worker.postMessage({ config, fox, rabbit, seed, start: Math.floor(games * i / count), end: Math.floor(games * (i + 1) / count) });
    }
  } catch (error) { cleanup(); throw error; }
  return { promise, snapshot, cancel: async () => { if (finished === count || stopped) return snapshot(); stopped = true; cleanup(); const result = snapshot(); onProgress(result); settle(result); return result; } };
}
