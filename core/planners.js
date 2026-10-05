import { hunt, rememberFox } from './fox-tracker.js';
import { rabbitAction } from './rabbit-planner.js';
import { RABBIT_STRATEGIES, normalizeRabbit } from '../rabbit-strategies.js';
import { hash, random, straightPaths, constructionLength,           } from './engine.js';

export const AGENT_VERSION = 'woodland-terrain-planners-1';
export const POLICIES = {
  fox: [{ id: 'tracker', name: 'Tracker', detail: 'Remembers searched routes, follows possible tunnel branches, and commits to a search destination until evidence changes.' }, { id: 'scout', name: 'Scout', detail: 'Remembers explored ground and tunnel branches, searches toward persistent destinations, and pursues sightings.' }, { id: 'random', name: 'Random', detail: 'A deliberately simple random baseline.' }],
  rabbit: [{ id: 'mixed', name: 'Strategy mix', detail: 'Blend five strategies in any proportions. Keep a multi-turn objective, adapt to the Fox, and vary plans between seeds.' }, ...RABBIT_STRATEGIES, { id: 'evasive', name: 'Evasive (legacy)', detail: 'The earlier safety-focused planner, kept for comparisons.' }, { id: 'wanderer', name: 'Wanderer (legacy)', detail: 'The earlier mobile planner, kept for comparisons.' }, { id: 'random', name: 'Random', detail: 'A deliberately simple random baseline.' }]
};
export function makeAgent(role      , input, seed        ) {
  const profile = role === 'rabbit' ? normalizeRabbit(input) : input;
  const policy = typeof profile === 'string' ? profile : profile?.id;
  if (!POLICIES[role].some(p => p.id === policy)) throw new Error(`Unknown ${role} strategy.`);
  return { role, policy, profile, rng: random(hash(`${seed}|agent|${role}|${policy}`)), memory: null };
}
function choose(list, rng) { return list[Math.floor(rng() * list.length)]; }
function tunnelNeighbors(board, masks, cell) {
  const out = [];
  for (let d = 0; d < 6; d++) if (masks[cell] & (1 << d)) { const id = board.neighbors[cell][d]; if (id >= 0) out.push(id); }
  return out;
}
const terrain = new WeakMap();
function geometry(board) {
  if (terrain.has(board)) return terrain.get(board);
  const center = Math.floor(board.rows / 2) * board.cols + Math.floor(board.cols / 2);
  const room = new Float32Array(board.size), local = [], rays = [];
  for (let id = 0; id < board.size; id++) {
    local[id] = board.cells.filter(c => board.distances[id][c.id] <= 2).map(c => c.id);
    rays[id] = [];
    for (let d = 0; d < 6; d++) {
      const line = []; let next = id;
      for (let i = 0; i < constructionLength(board, id, 6); i++) { next = board.neighbors[next][d]; if (next < 0 || board.terrain[next] === 'rock') break; line.push(next); }
      rays[id].push(line); room[id] += Math.min(4, line.length) / 24;
    }
  }
  const result = { center, room, local, rays }; terrain.set(board, result); return result;
}
function rabbitMemory(agent, obs) {
  if (!agent.memory) agent.memory = { round: 0, visits: new Float32Array(obs.board.size), buildPlan: [], movePlan: [] };
  const m = agent.memory;
  if (m.round !== obs.round) {
    for (let i = 0; i < m.visits.length; i++) m.visits[i] *= .88;
    m.visits[obs.rabbit]++; m.round = obs.round; m.buildPlan = []; m.movePlan = [];
  }
  return m;
}
// P(sum of 2d4 >= distance). Extra separation beyond capture range should not
// outweigh useful escape routes and drive an already safe Rabbit into a corner.
const catchChance = [1, 1, 1, 15/16, 13/16, 10/16, 6/16, 3/16, 1/16];
function rabbitValues(agent, obs, masks = obs.masks) {
  const { board } = obs, m = rabbitMemory(agent, obs), geo = geometry(board), values = new Float32Array(board.size);
  for (let id = 0; id < board.size; id++) {
    if (id === obs.fox || board.terrain[id] === 'rock') { values[id] = -1e6; continue; }
    const distance = board.distances[obs.fox][id];
    let nearbyVisits = 0, exits = 0;
    for (const n of geo.local[id]) nearbyVisits += m.visits[n];
    for (const line of geo.rays[id]) if (line.length >= 3 && board.distances[obs.fox][line[2]] >= distance) exits++;
    const mobility = tunnelNeighbors(board, masks, id).length;
    values[id] = -95 * (catchChance[distance] || 0) + Math.min(distance, 9) * .65
      + geo.room[id] * 5 + exits * .6 + mobility * .32
      - board.distances[geo.center][id] * (agent.policy === 'wanderer' ? .48 : .34)
      - nearbyVisits * (agent.policy === 'wanderer' ? 2.3 : 1.7) - m.visits[id] * 2.3
      - (id === obs.origin ? 1.4 : 0);
  }
  return values;
}
function addPath(board, masks, path) {
  const next = masks.slice();
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1], b = path[i], d = board.neighbors[a].indexOf(b);
    next[a] |= 1 << d; next[b] |= 1 << ((d + 3) % 6);
  }
  return next;
}
// Score exact-length endpoints for every possible movement roll, before that
// private die has been rolled. Include the worst roll as well as the average.
function constructionScore(obs, masks, values) {
  const { board } = obs;
  let frontier = [obs.origin], sum = 0, worst = Infinity;
  const reached = new Uint8Array(board.size), stamp = new Uint8Array(board.size);
  let distinct = 0;
  for (let step = 1; step <= 6; step++) {
    const next = []; let best = -1e6;
    for (const from of frontier) for (let d = 0; d < 6; d++) if (masks[from] & (1 << d)) {
      const id = board.neighbors[from][d];
      if (id < 0 || id === obs.fox || stamp[id] === step) continue;
      stamp[id] = step; next.push(id);
      if (!reached[id]) { reached[id] = 1; distinct++; }
      best = Math.max(best, values[id]);
    }
    sum += best; worst = Math.min(worst, best); frontier = next;
  }
  return sum / 6 * .8 + worst * .2 + Math.log1p(distinct) * 1.1;
}
function planConstruction(agent, obs) {
  const values = rabbitValues(agent, obs), width = agent.policy === 'evasive' ? 5 : 3;
  let beam = [{ masks: obs.masks, used: [...obs.used], actions: [], score: -Infinity }];
  for (let depth = 0; depth < obs.used.filter(x => !x).length; depth++) {
    const candidates = [];
    for (const state of beam) {
      const lengths = new Set(); let extended = false;
      for (let die = 0; die < 3; die++) {
        if (state.used[die] || lengths.has(obs.dice[die])) continue;
        lengths.add(obs.dice[die]);
        for (const path of straightPaths(obs.board, obs.origin, constructionLength(obs.board, obs.origin, obs.dice[die]), state.masks)) {
          const masks = addPath(obs.board, state.masks, path), used = [...state.used]; used[die] = true;
          const score = constructionScore(obs, masks, values) + agent.rng() * .015;
          candidates.push({ masks, used, actions: [...state.actions, { type: 'dig', die, path }], score }); extended = true;
        }
      }
      if (!extended) candidates.push(state); // The referee skips these impossible dice.
    }
    candidates.sort((a, b) => b.score - a.score); beam = candidates.slice(0, width);
  }
  return beam[0].actions;
}
function planRabbitMove(agent, obs) {
  const { board } = obs, values = rabbitValues(agent, obs), choices = [];
  let previous = values;
  for (let step = 1; step <= obs.remaining; step++) {
    const next = new Float32Array(board.size).fill(-1e6), moves = new Int16Array(board.size).fill(-1);
    for (let id = 0; id < board.size; id++) if (id !== obs.fox && obs.masks[id]) {
      for (const n of tunnelNeighbors(board, obs.masks, id)) if (n !== obs.fox) {
        const value = previous[n] + agent.rng() * .002;
        if (value > next[id]) { next[id] = value; moves[id] = n; }
      }
    }
    choices[step] = moves; previous = next;
  }
  const path = []; let from = obs.rabbit;
  for (let step = obs.remaining; step > 0; step--) {
    let to = choices[step][from];
    if (to < 0) to = tunnelNeighbors(board, obs.masks, from)[0]; // Only forced capture remains.
    path.push(to); from = to;
  }
  return path;
}
export function decide(agent, obs) {
  const { board, phase } = obs;
  if (agent.role === 'rabbit' && !['evasive', 'wanderer', 'random'].includes(agent.policy)) return rabbitAction(agent, obs);
  if (agent.role === 'fox' && phase === 'fox_roll') rememberFox(agent, obs);
  if (agent.role === 'rabbit' && agent.policy !== 'random') rabbitMemory(agent, obs);
  if (phase.includes('roll')) return { type: 'roll' };
  if (phase === 'rabbit_dig') {
    if (agent.policy === 'random') {
      const die = obs.used.findIndex(x => !x);
      return { type: 'dig', die, path: choose(straightPaths(board, obs.origin, constructionLength(board, obs.origin, obs.dice[die]), obs.masks), agent.rng) };
    }
    const m = rabbitMemory(agent, obs);
    while (m.buildPlan.length && obs.used[m.buildPlan[0].die]) m.buildPlan.shift();
    if (!m.buildPlan.length) m.buildPlan = planConstruction(agent, obs);
    return m.buildPlan.shift();
  }
  if (phase === 'rabbit_move') {
    if (agent.policy === 'random') return { type: 'move', to: choose(tunnelNeighbors(board, obs.masks, obs.rabbit), agent.rng) };
    const m = rabbitMemory(agent, obs);
    if (m.movePlan.length !== obs.remaining) m.movePlan = planRabbitMove(agent, obs);
    return { type: 'move', to: m.movePlan.shift() };
  }
  if (phase === 'fox_move') {
    if (agent.policy === 'random') return { type: 'move', to: choose(board.neighbors[obs.fox].filter(n => n >= 0), agent.rng) };
    return hunt(agent, obs);
  }
  throw new Error(`Agent cannot act during ${phase}.`);
}
