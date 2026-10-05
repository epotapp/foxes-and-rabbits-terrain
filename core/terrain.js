// Seeded, geometry-checked terrain. This module never uses a game's dice seed.
export const TERRAIN_PROFILES = {
  open: { name: 'Open glade', rock: .035, sand: .22 },
  balanced: { name: 'Woodland mosaic', rock: .065, sand: .30 },
  rugged: { name: 'Rocky grove', rock: .10, sand: .38 }
};
function randomSeed(text) {
  let seed = 2166136261;
  for (let i = 0; i < text.length; i++) seed = Math.imul(seed ^ text.charCodeAt(i), 16777619);
  return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
}
function ray(board, origin, direction, length) {
  const path = [origin]; let from = origin;
  for (let i = 0; i < length; i++) { from = board.neighbors[from][direction]; if (from < 0) return null; path.push(from); }
  return path;
}
function connected(board, terrain) {
  const start = terrain.findIndex(t => t !== 'rock'), seen = new Set([start]), queue = [start];
  for (let i = 0; i < queue.length; i++) for (const n of board.neighbors[queue[i]]) if (n >= 0 && terrain[n] !== 'rock' && !seen.has(n)) { seen.add(n); queue.push(n); }
  return seen.size === terrain.filter(t => t !== 'rock').length;
}
export function terrainAudit(board, terrain) {
  const counts = { ground: 0, sand: 0, rock: 0 }; terrain.forEach(t => counts[t]++);
  let trappedCells = 0, narrowCells = 0, maxRockCluster = 0;
  for (let id = 0; id < board.size; id++) if (terrain[id] !== 'rock') {
    const maxLength = terrain[id] === 'ground' ? 7 : 6;
    if (!board.neighbors[id].some((_, d) => ray(board, id, d, maxLength)?.every(n => terrain[n] !== 'rock'))) trappedCells++;
    if (board.neighbors[id].filter(n => n >= 0 && terrain[n] !== 'rock').length < 2) narrowCells++;
  }
  const seen = new Set();
  for (let id = 0; id < board.size; id++) if (terrain[id] === 'rock' && !seen.has(id)) {
    const cluster = [id]; seen.add(id);
    for (let i = 0; i < cluster.length; i++) for (const n of board.neighbors[cluster[i]]) if (n >= 0 && terrain[n] === 'rock' && !seen.has(n)) { seen.add(n); cluster.push(n); }
    maxRockCluster = Math.max(maxRockCluster, cluster.length);
  }
  const openingLength = terrain[board.rabbitStart] === 'ground' ? 7 : 6;
  const openingDirections = board.neighbors[board.rabbitStart].filter((_, d) => ray(board, board.rabbitStart, d, openingLength)?.every(id => terrain[id] !== 'rock')).length;
  return { counts, connected: connected(board, terrain), trappedCells, narrowCells, maxRockCluster, openingDirections };
}
export function generateTerrain(board, config) {
  if (config.terrainCells) return [...config.terrainCells];
  const profile = TERRAIN_PROFILES[config.terrainProfile], rng = randomSeed(`${config.mapSeed}|${board.cols}|${board.rows}|terrain-1`);
  const terrain = Array(board.size).fill('ground'), protectedCells = new Set([board.foxStart, board.rabbitStart]);
  // Preserve several long opening choices, not a single scripted escape.
  const openings = board.neighbors[board.rabbitStart].map((_, d) => ray(board, board.rabbitStart, d, 7)).filter(Boolean);
  const shuffled = openings.map(path => ({ path, rank: rng() })).sort((a, b) => a.rank - b.rank);
  for (const { path } of shuffled.slice(0, 3)) path.forEach(id => protectedCells.add(id));
  for (const c of board.cells) if (board.distances[board.rabbitStart][c.id] <= 2) protectedCells.add(c.id);
  // A wide central corridor keeps cross-board migration possible.
  const centerCol = Math.floor(board.cols / 2);
  for (const c of board.cells) if (Math.abs(c.col - centerCol) <= 1) protectedCells.add(c.id);
  const rockTarget = Math.round(board.size * profile.rock);
  let rockCount = 0;
  for (let attempt = 0; attempt < board.size * 5 && rockCount < rockTarget; attempt++) {
    const start = Math.floor(rng() * board.size);
    if (protectedCells.has(start) || terrain[start] === 'rock' || board.neighbors[start].some(n => terrain[n] === 'rock')) continue;
    const patch = [start], length = 1 + Math.floor(rng() * 3);
    for (let i = 1; i < length; i++) {
      const choices = board.neighbors[patch.at(-1)].filter(n => n >= 0 && !protectedCells.has(n) && !patch.includes(n) && terrain[n] !== 'rock' && board.neighbors[n].every(k => terrain[k] !== 'rock'));
      if (!choices.length) break; patch.push(choices[Math.floor(rng() * choices.length)]);
    }
    for (const id of patch.slice(0, rockTarget - rockCount)) { terrain[id] = 'rock'; rockCount++; }
  }
  // Sand forms irregular connected patches; most permanent ground remains linked.
  let sandCount = 0, sandTarget = Math.round(board.size * profile.sand);
  const seeds = Array.from({ length: Math.max(3, Math.round(board.size / 55)) }, () => Math.floor(rng() * board.size));
  const rank = board.cells.map(c => ({ id: c.id, score: Math.min(...seeds.map(id => board.distances[id][c.id])) + rng() * 1.1 }));
  rank.sort((a, b) => a.score - b.score);
  for (const { id } of rank) if (terrain[id] === 'ground' && id !== board.rabbitStart && id !== board.foxStart && sandCount < sandTarget) { terrain[id] = 'sand'; sandCount++; }
  // Repair potential collapse traps: every diggable hex must have at least one
  // full maximum-roll ray. Choose the ray requiring the fewest removed rocks.
  let repaired = true;
  while (repaired) {
    repaired = false;
    for (let id = 0; id < board.size; id++) if (terrain[id] !== 'rock') {
      const adjacent = board.neighbors[id].filter(n => n >= 0);
      while (adjacent.filter(n => terrain[n] !== 'rock').length < 2) { const n = adjacent.find(n => terrain[n] === 'rock'); if (n === undefined) break; terrain[n] = 'sand'; repaired = true; }
      let length = terrain[id] === 'ground' ? 7 : 6;
      let choices = board.neighbors[id].map((_, d) => ray(board, id, d, length)).filter(Boolean);
      if (!choices.length && terrain[id] === 'ground') { terrain[id] = 'sand'; length = 6; choices = board.neighbors[id].map((_, d) => ray(board, id, d, length)).filter(Boolean); }
      choices.sort((a, b) => a.filter(n => terrain[n] === 'rock').length - b.filter(n => terrain[n] === 'rock').length);
      for (const n of choices[0] || []) if (terrain[n] === 'rock') { terrain[n] = 'sand'; repaired = true; }
    }
    // In the unlikely case a small outcrop cuts a corner off, open the boundary
    // rock with the most diggable neighbours until connectivity is restored.
    while (!connected(board, terrain)) {
      const candidates = board.cells.filter(c => terrain[c.id] === 'rock').sort((a, b) => board.neighbors[b.id].filter(n => n >= 0 && terrain[n] !== 'rock').length - board.neighbors[a.id].filter(n => n >= 0 && terrain[n] !== 'rock').length);
      if (!candidates.length) break; terrain[candidates[0].id] = 'sand'; repaired = true;
    }
  }
  return terrain;
}
