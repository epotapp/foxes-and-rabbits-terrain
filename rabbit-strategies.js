export const RABBIT_STRATEGIES = [
  { id: 'architect', name: 'Warren architect', detail: 'Build connected junctions and alternate exits. Reuse a useful network, then relocate before the Fox closes in.' },
  { id: 'pathfinder', name: 'Pathfinder', detail: 'Commit to a distant, lightly visited region. Dig migration corridors through open interior ground and keep a fallback exit.' },
  { id: 'trickster', name: 'Trickster', detail: 'Lay divergent decoy branches toward the approaching Fox, then escape sideways through a different branch.' },
  { id: 'outrider', name: 'Outrider', detail: 'Circle the Fox at a safe distance. Anticipate its heading, maintain a chosen circling direction, and avoid interception.' },
  { id: 'ghost', name: 'Ghost', detail: 'Watch the Fox pass, then return through recently searched ground. Reuse old tunnels to avoid a predictable trail of new endpoints.' }
];
export const DEFAULT_MIX = Object.fromEntries(RABBIT_STRATEGIES.map(s => [s.id, 20]));
export function normalizeRabbit(value = 'mixed') {
  const id = typeof value === 'string' ? value : value?.id;
  if (id !== 'mixed') {
    if (typeof value !== 'string' || ![...RABBIT_STRATEGIES.map(s => s.id), 'evasive', 'wanderer', 'random'].includes(id)) throw new Error('Choose a valid Rabbit strategy.');
    return id;
  }
  const input = typeof value === 'string' ? DEFAULT_MIX : value.weights;
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(id => !Object.hasOwn(DEFAULT_MIX, id))) throw new Error('Use the five available Rabbit strategy weights.');
  const weights = {};
  for (const s of RABBIT_STRATEGIES) {
    const n = input[s.id] ?? 0;
    if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Rabbit weights must be numbers from 0 to 100.');
    weights[s.id] = n;
  }
  if (!Object.values(weights).some(n => n > 0)) throw new Error('Give at least one Rabbit strategy a positive weight.');
  return { id, weights };
}
export function rabbitWeights(profile) {
  const p = normalizeRabbit(profile);
  const weights = typeof p === 'string' ? Object.fromEntries(RABBIT_STRATEGIES.map(s => [s.id, Number(s.id === p)])) : p.weights;
  const total = Object.values(weights).reduce((a, b) => a + b, 0);
  return Object.fromEntries(Object.entries(weights).map(([id, n]) => [id, n / (total || 1)]));
}
