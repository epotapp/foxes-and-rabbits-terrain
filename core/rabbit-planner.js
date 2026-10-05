import { straightPaths, constructionLength } from './engine.js';
import { RABBIT_STRATEGIES, rabbitWeights } from '../rabbit-strategies.js';

const cache = new WeakMap();
const catchChance = [1, 1, 1, 15/16, 13/16, 10/16, 6/16, 3/16, 1/16];
function geometry(board) {
  if (cache.has(board)) return cache.get(board);
  const rays = [], room = [], local = [];
  for (const cell of board.cells) {
    rays[cell.id] = board.neighbors[cell.id].map((_, d) => {
      const line = []; let from = cell.id;
      for (let step = 0; step < constructionLength(board, cell.id, 6); step++) { from = board.neighbors[from][d]; if (from < 0 || board.terrain[from] === 'rock') break; line.push(from); }
      return line;
    });
    room[cell.id] = rays[cell.id].reduce((sum, ray) => sum + Math.min(4, ray.length), 0) / 24;
    local[cell.id] = board.cells.filter(c => board.distances[cell.id][c.id] <= 2).map(c => c.id);
  }
  const result = { rays, room, local, center: Math.floor(board.rows / 2) * board.cols + Math.floor(board.cols / 2) };
  cache.set(board, result); return result;
}
const degree = mask => { let n = 0; for (; mask; mask &= mask - 1) n++; return n; };
function weightedChoice(items, rng) {
  let n = rng() * items.reduce((sum, item) => sum + item.weight, 0);
  return items.find(item => (n -= item.weight) < 0) ?? items.at(-1);
}
function heading(m, board, fox) {
  const a = board.cells[m.lastFox ?? fox], b = board.cells[fox];
  const dx = b.x - a.x, dy = b.y - a.y, norm = Math.hypot(dx, dy) || 1;
  return { x: dx / norm, y: dy / norm };
}
function choosePlan(agent, obs, m) {
  const { board } = obs, geo = geometry(board), distance = board.distances[obs.fox][obs.rabbit];
  const opportunities = { architect: 1 + Math.min(1, degree(obs.masks[obs.rabbit]) / 4), pathfinder: 1 + Math.min(1, m.visits[obs.rabbit] / 3), trickster: distance < 10 ? 1.6 : .8, outrider: distance < 11 ? 1.5 : 1, ghost: m.round > 2 && Math.hypot(m.heading.x, m.heading.y) > 0 ? 1.6 : .5 };
  const lead = weightedChoice(RABBIT_STRATEGIES.map(s => ({ id: s.id, weight: m.weights[s.id] * opportunities[s.id] })).filter(s => s.weight), agent.rng).id;
  const fox = board.cells[obs.fox], rabbit = board.cells[obs.rabbit];
  const dx = rabbit.x - fox.x, dy = rabbit.y - fox.y, norm = Math.hypot(dx, dy) || 1;
  const tangent = { x: -dy / norm * m.clockwise, y: dx / norm * m.clockwise };
  const candidates = [];
  for (const c of board.cells) {
    const travel = board.distances[obs.rabbit][c.id], danger = board.distances[obs.fox][c.id];
    if (board.terrain[c.id] === 'rock' || travel < 3 || danger < Math.min(7, distance + 1)) continue;
    let visits = 0; for (const id of geo.local[c.id]) visits += m.visits[id];
    const displacement = { x: (c.x - rabbit.x) / 1.73, y: (c.y - rabbit.y) / 1.73 };
    const back = -((c.x - fox.x) * m.heading.x + (c.y - fox.y) * m.heading.y) / 1.73;
    const features = {
      architect: degree(obs.masks[c.id]) * 1.2 + geo.room[c.id] * 4 - Math.abs(travel - 5) * .6 - visits * 1.4,
      pathfinder: Math.min(travel, 8) * .7 - visits * 1.2 - board.distances[geo.center][c.id] * .35,
      trickster: (displacement.x * tangent.x + displacement.y * tangent.y) * .7 + degree(obs.masks[c.id]) * .7 - Math.abs(travel - 5) * .3,
      outrider: (displacement.x * tangent.x + displacement.y * tangent.y) * .9 - Math.abs(danger - m.orbit) * 1.2,
      ghost: Math.min(6, back) * .6 + (m.foxSeen[c.id] >= m.round - 4 ? 4 : 0) + (obs.masks[c.id] ? 1.5 : 0) - Math.abs(travel - 5) * .3
    };
    let score = -70 * (catchChance[danger] || 0) + geo.room[c.id] * 2 - m.visits[c.id] * .7;
    for (const s of RABBIT_STRATEGIES) score += m.weights[s.id] * features[s.id];
    score += features[lead] * .6;
    candidates.push({ cell: c.id, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  const top = candidates.slice(0, 8), best = top[0]?.score ?? 0;
  const target = top.length ? weightedChoice(top.map(c => ({ ...c, weight: Math.exp((c.score - best) / 1.3) })), agent.rng).cell : obs.rabbit;
  m.plan = { lead, target, since: obs.round, until: obs.round + 2 + Math.floor(agent.rng() * 3) };
  m.planHistory.push({ ...m.plan });
  m.taste = Float32Array.from({ length: board.size }, () => agent.rng() * .9);
}
export function rememberRabbit(agent, obs) {
  const { board } = obs;
  if (!agent.memory) agent.memory = { round: 0, visits: new Float32Array(board.size), foxSeen: new Int16Array(board.size).fill(-100), weights: rabbitWeights(agent.profile), plan: null, planHistory: [], lastFox: null, heading: { x: 0, y: 0 }, clockwise: agent.rng() < .5 ? -1 : 1, orbit: 8 + agent.rng() * 2, buildPlan: [], movePlan: [] };
  const m = agent.memory;
  if (m.round !== obs.round) {
    m.heading = heading(m, board, obs.fox); m.lastFox = obs.fox; m.round = obs.round;
    for (const id of board.visibility[obs.fox]) m.foxSeen[id] = obs.round;
    for (let id = 0; id < board.size; id++) m.visits[id] *= .93;
    m.visits[obs.rabbit]++; m.buildPlan = []; m.movePlan = [];
    const unsafe = m.plan && board.distances[obs.fox][m.plan.target] < 6;
    if (!m.plan || obs.round >= m.plan.until || board.distances[obs.rabbit][m.plan.target] <= 1 || unsafe) choosePlan(agent, obs, m);
  }
  return m;
}
function valuesFor(agent, obs) {
  const { board } = obs, m = rememberRabbit(agent, obs), geo = geometry(board), values = new Float32Array(board.size);
  const fox = board.cells[obs.fox], rabbit = board.cells[obs.rabbit];
  const dx = rabbit.x - fox.x, dy = rabbit.y - fox.y, norm = Math.hypot(dx, dy) || 1;
  const tx = -dy / norm * m.clockwise, ty = dx / norm * m.clockwise;
  for (const c of board.cells) {
    if (c.id === obs.fox || board.terrain[c.id] === 'rock') { values[c.id] = -1e6; continue; }
    const distance = board.distances[obs.fox][c.id], mobility = degree(obs.masks[c.id]);
    // Count exits that survive the next maintenance step. Recently dug sand
    // remains useful; an ageing sand-only warren should not become a home base.
    let lasting = 0;
    for (let d = 0; d < 6; d++) if ((obs.masks[c.id] & (1 << d)) && (!obs.expires?.[c.id * 6 + d] || obs.expires[c.id * 6 + d] > obs.round + 1)) lasting++;
    const terrainValue = (board.terrain[c.id] === 'ground' ? .8 : 0) + lasting * .5 - (mobility && !lasting ? 2 : 0);
    let visits = 0, exits = 0;
    for (const id of geo.local[c.id]) visits += m.visits[id];
    // A two-turn escape proxy: can this endpoint dig useful full-length rays
    // next turn, in several directions, without turning back toward the Fox?
    for (const ray of geo.rays[c.id]) if (ray.length >= 3 && board.distances[obs.fox][ray[2]] >= Math.min(distance + 1, 10)) exits++;
    const targetDistance = board.distances[c.id][m.plan.target];
    const lateral = ((c.x - rabbit.x) * tx + (c.y - rabbit.y) * ty) / 1.73;
    const behind = -((c.x - fox.x) * m.heading.x + (c.y - fox.y) * m.heading.y) / 1.73;
    const searched = m.foxSeen[c.id] >= m.round - 4 && m.foxSeen[c.id] < m.round;
    const features = {
      architect: mobility * .8 + exits + geo.room[c.id] * 3 - targetDistance * .85 - visits * 1.8 - m.visits[c.id] * 1.5,
      pathfinder: -targetDistance * 1.4 - visits * 1.4 - board.distances[geo.center][c.id] * .2,
      trickster: lateral * .55 + mobility * .7 - targetDistance * .75 - visits * .35,
      outrider: lateral * .65 - Math.abs(distance - m.orbit) * 1.15 - targetDistance * .8,
      ghost: (searched ? 4 : 0) + (obs.masks[c.id] ? 1.8 : 0) + Math.min(6, behind) * .4 - targetDistance * .7
    };
    let value = -100 * (catchChance[distance] || 0) + Math.min(distance, 9) * .5 + geo.room[c.id] * 3 + exits * .45 - m.visits[c.id] * .7;
    for (const s of RABBIT_STRATEGIES) value += m.weights[s.id] * features[s.id];
    value += features[m.plan.lead] * .35 + m.taste[c.id] + terrainValue;
    // Penalize ground ahead of the observed Fox heading; this is an estimate,
    // never access to the Fox controller's private beliefs or next action.
    const ahead = ((c.x - fox.x) * m.heading.x + (c.y - fox.y) * m.heading.y) / 1.73;
    if (ahead > 0 && distance < 10) value -= (10 - distance) * .3;
    values[c.id] = value;
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
function constructionScore(obs, masks, values, m) {
  const { board } = obs;
  let frontier = [obs.origin], sum = 0, worst = Infinity, distinct = 0;
  const reached = new Uint8Array(board.size), stamp = new Uint8Array(board.size);
  for (let step = 1; step <= 6; step++) {
    const next = []; let best = -1e6, second = -1e6;
    for (const from of frontier) for (let d = 0; d < 6; d++) if (masks[from] & (1 << d)) {
      const id = board.neighbors[from][d];
      if (id < 0 || id === obs.fox || stamp[id] === step) continue;
      stamp[id] = step; next.push(id); if (!reached[id]) { reached[id] = 1; distinct++; }
      const value = values[id] + (degree(masks[id]) - degree(obs.masks[id])) * (m.weights.architect * 1.5 + .15);
      if (value > best) { second = best; best = value; } else second = Math.max(second, value);
    }
    // More than one good escape matters: a fragile single exit is not a warren.
    const robust = second > -1e5 ? best * .9 + second * .1 : best;
    sum += robust; worst = Math.min(worst, best); frontier = next;
  }
  return sum / 6 * .78 + worst * .22 + Math.log1p(distinct) * (1 + m.weights.architect * 1.5);
}
function constructionPlan(agent, obs) {
  const m = rememberRabbit(agent, obs), values = valuesFor(agent, obs);
  let beam = [{ masks: obs.masks, used: [...obs.used], actions: [], bonus: 0, score: -Infinity }];
  for (let depth = 0; depth < obs.used.filter(x => !x).length; depth++) {
    const candidates = [];
    for (const state of beam) {
      const lengths = new Set(); let extended = false;
      for (let die = 0; die < 3; die++) {
        if (state.used[die] || lengths.has(obs.dice[die])) continue;
        lengths.add(obs.dice[die]);
        for (const path of straightPaths(obs.board, obs.origin, constructionLength(obs.board, obs.origin, obs.dice[die]), state.masks)) {
          const masks = addPath(obs.board, state.masks, path), used = [...state.used]; used[die] = true;
          const end = path.at(-1), { distances } = obs.board;
          const joins = path.slice(1).filter(id => obs.masks[id]).length;
          const towardFox = distances[end][obs.fox] < distances[obs.origin][obs.fox];
          const awayFromGoal = distances[end][m.plan.target] > distances[obs.origin][m.plan.target];
          const progress = distances[obs.origin][m.plan.target] - distances[end][m.plan.target];
          const durable = path.slice(1).filter((id, i) => obs.board.terrain[id] === 'ground' && obs.board.terrain[path[i]] === 'ground').length;
          const bonus = state.bonus + durable * (.08 + m.weights.architect * .12) + m.weights.architect * Math.min(joins, 3) * .8
            + m.weights.trickster * Number(towardFox && awayFromGoal) * 2
            + m.weights.pathfinder * progress * .18 + m.weights.ghost * Math.min(joins, 2) * .5;
          const score = constructionScore(obs, masks, values, m) + bonus + agent.rng() * .02;
          candidates.push({ masks, used, actions: [...state.actions, { type: 'dig', die, path }], bonus, score }); extended = true;
        }
      }
      if (!extended) candidates.push(state);
    }
    candidates.sort((a, b) => b.score - a.score); beam = candidates.slice(0, 5);
  }
  return beam[0].actions;
}
function movementPlan(agent, obs) {
  const { board } = obs, m = rememberRabbit(agent, obs), values = valuesFor(agent, obs), choices = [];
  let previous = values;
  for (let step = 1; step <= obs.remaining; step++) {
    const next = new Float32Array(board.size).fill(-1e6), moves = new Int16Array(board.size).fill(-1);
    for (let id = 0; id < board.size; id++) if (id !== obs.fox) {
      for (let d = 0; d < 6; d++) if (obs.masks[id] & (1 << d)) {
        const n = board.neighbors[id][d]; if (n < 0 || n === obs.fox) continue;
        const value = previous[n] - m.visits[n] * .008;
        if (value > next[id]) { next[id] = value; moves[id] = n; }
      }
    }
    choices[step] = moves; previous = next;
  }
  const path = []; let from = obs.rabbit;
  for (let step = obs.remaining; step > 0; step--) {
    let to = choices[step][from];
    if (to < 0) to = board.neighbors[from].find((n, d) => n >= 0 && (obs.masks[from] & (1 << d)));
    path.push(to); from = to;
  }
  return path;
}
export function rabbitAction(agent, obs) {
  const m = rememberRabbit(agent, obs);
  if (obs.phase.includes('roll')) return { type: 'roll' };
  if (obs.phase === 'rabbit_dig') {
    while (m.buildPlan.length && obs.used[m.buildPlan[0].die]) m.buildPlan.shift();
    if (!m.buildPlan.length) m.buildPlan = constructionPlan(agent, obs);
    return m.buildPlan.shift();
  }
  if (m.movePlan.length !== obs.remaining) m.movePlan = movementPlan(agent, obs);
  return { type: 'move', to: m.movePlan.shift() };
}
