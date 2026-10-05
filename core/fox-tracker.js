import { constructionLength, sandConnection } from './engine.js';
// Everything in this module comes from filtered Fox observations. Possible
// edges are hypotheses; only known edges have actually been seen on the board.
const geometry = new WeakMap();
function rays(board) {
  if (geometry.has(board)) return geometry.get(board);
  const masks = board.cells.map(origin => {
    const result = new Uint8Array(board.size);
    if (board.terrain[origin.id] === 'rock') return result;
    for (let direction = 0; direction < 6; direction++) {
      let from = origin.id;
      for (let step = 0; step < constructionLength(board, origin.id, 6); step++) {
        const to = board.neighbors[from][direction]; if (to < 0 || board.terrain[to] === 'rock') break;
        result[from] |= 1 << direction; result[to] |= 1 << ((direction + 3) % 6); from = to;
      }
    }
    return result;
  });
  geometry.set(board, masks); return masks;
}
function memory(agent, board) {
  if (!agent.memory) {
    const belief = new Float64Array(board.size); belief[board.rabbitStart] = 1;
    agent.memory = {
      edgeSeen: new Int16Array(board.size * 6).fill(-100), known: new Uint8Array(board.size), possible: new Uint8Array(board.size),
      seen: new Int16Array(board.size).fill(-1), visits: new Uint16Array(board.size),
      lastVisit: new Int32Array(board.size).fill(-1000), traversals: new Uint16Array(board.size * 6),
      belief, branches: [], round: 0, lastPosition: -1, tick: 0,
      goal: null, previous: -1, goalChanges: 0, fallbackCount: 0, lastSighting: null,
    };
  }
  return agent.memory;
}

// One hypothesis branches from a possible construction origin. New tunnels
// can only follow straight rays from that origin. Movement may then turn along
// existing or previously hypothesized connections. The union is deliberately
// conservative: it does not pretend the private construction dice are known.
function expand(board, m, origin, start, fresh, fox) {
  const endpoints = new Float64Array(board.size);
  let current = start, active = [];
  for (let id = 0; id < board.size; id++) if (current[id] > 0) active.push(id);
  const weights = new Float64Array(6);
  for (let step = 1; step <= 6 && active.length; step++) {
    const next = new Float64Array(board.size), nextActive = [];
    for (const from of active) {
      const mask = m.possible[from] | fresh[from]; let total = 0;
      for (let d = 0; d < 6; d++) {
        const to = board.neighbors[from][d]; let weight = 0;
        if (to >= 0 && to !== fox && (mask & (1 << d))) {
          weight = m.known[from] & (1 << d) ? 1.6 : fresh[from] & (1 << d) ? 1 : .25;
          // Legal backtracking remains possible, but purposeful escape paths
          // should carry more weight than a random walk circling its origin.
          if (origin >= 0) weight *= board.distances[origin][to] > board.distances[origin][from] ? 1.7 : .3;
          if (board.distances[fox][from] < 9) weight *= board.distances[fox][to] > board.distances[fox][from] ? 1.4 : board.distances[fox][to] < board.distances[fox][from] ? .55 : 1;
        }
        weights[d] = weight; total += weight;
      }
      if (total) for (let d = 0; d < 6; d++) if (weights[d]) {
        const to = board.neighbors[from][d]; if (!next[to]) nextActive.push(to);
        next[to] += current[from] * weights[d] / total;
      }
    }
    for (const id of nextActive) endpoints[id] += next[id] / 6;
    current = next; active = nextActive;
  }
  return { origin, endpoints };
}
function predict(m, obs) {
  const { board } = obs, lines = rays(board), origins = [];
  for (let id = 0; id < board.size; id++) if (m.belief[id] > 0) origins.push(id);
  origins.sort((a, b) => m.belief[b] - m.belief[a]);
  const allFresh = new Uint8Array(board.size), tailFresh = new Uint8Array(board.size), tail = new Float64Array(board.size), branches = [];
  for (let index = 0; index < origins.length; index++) {
    const origin = origins[index], fresh = lines[origin];
    for (let id = 0; id < board.size; id++) allFresh[id] |= fresh[id];
    if (index < 24) {
      const start = new Float64Array(board.size); start[origin] = m.belief[origin];
      branches.push(expand(board, m, origin, start, fresh, obs.fox));
    } else {
      tail[origin] = m.belief[origin];
      for (let id = 0; id < board.size; id++) tailFresh[id] |= fresh[id];
    }
  }
  // Keep the low-probability tail instead of declaring omitted origins impossible.
  if (origins.length > 24) branches.push(expand(board, m, -1, tail, tailFresh, obs.fox));
  for (let id = 0; id < board.size; id++) m.possible[id] |= allFresh[id];
  m.branches = branches;
  combine(m, obs);
}
function combine(m, obs) {
  m.belief.fill(0);
  for (const branch of m.branches) for (let id = 0; id < obs.board.size; id++) m.belief[id] += branch.endpoints[id];
  let total = m.belief.reduce((sum, n) => sum + n, 0);
  if (total < 1e-14) {
    m.fallbackCount++;
    const endpoints = new Float64Array(obs.board.size);
    for (let id = 0; id < obs.board.size; id++) if (m.seen[id] !== obs.round && id !== obs.fox && obs.board.terrain[id] !== 'rock') {
      endpoints[id] = (m.known[id] ? 3 : m.possible[id] ? 1 : .1) / (1 + m.visits[id] * .5); total += endpoints[id];
    }
    m.branches = [{ origin: -1, endpoints }]; m.belief.set(endpoints);
  }
  if (total) for (let id = 0; id < obs.board.size; id++) m.belief[id] /= total;
}

export function rememberFox(agent, obs) {
  if (agent.role !== 'fox' || agent.policy === 'random' || !obs.phase.startsWith('fox')) return;
  const { board } = obs, m = memory(agent, board), lines = rays(board);
  if (m.round !== obs.round) {
    // The Fox knows the public lifetime, never the Rabbit's hidden timestamps.
    // An old sand edge loses confirmed status; a redraw remains a hypothesis.
    for (let id = 0; id < board.size; id++) for (let d = 0; d < 6; d++) {
      const to = board.neighbors[id][d];
      if (to >= 0 && sandConnection(board, id, to) && obs.round - m.edgeSeen[id * 6 + d] >= 3) m.known[id] &= ~(1 << d);
    }
    for (let round = m.round; round < obs.round; round++) predict(m, obs);
    m.round = obs.round;
  }
  // A new connection through a cell checked last round must have been dug
  // from this turn's Rabbit origin. Reject incompatible explicit branches.
  const fresh = [];
  for (const id of obs.visible) if (m.seen[id] === obs.round - 1) {
    const added = obs.masks[id] & ~m.known[id]; if (added) fresh.push([id, added]);
  }
  if (fresh.length) for (const branch of m.branches) if (branch.origin >= 0 && fresh.some(([id, mask]) => (lines[branch.origin][id] & mask) !== mask)) branch.endpoints.fill(0);
  for (const id of obs.visible) {
    m.known[id] = obs.masks[id]; m.possible[id] = obs.masks[id]; m.seen[id] = obs.round;
    for (let d = 0; d < 6; d++) {
      const neighbor = board.neighbors[id][d]; if (neighbor < 0) continue;
      const reciprocal = 1 << ((d + 3) % 6);
      if (obs.masks[id] & (1 << d)) { m.edgeSeen[id * 6 + d] = obs.round; m.edgeSeen[neighbor * 6 + ((d + 3) % 6)] = obs.round; m.known[neighbor] |= reciprocal; m.possible[neighbor] |= reciprocal; }
      else { m.known[neighbor] &= ~reciprocal; m.possible[neighbor] &= ~reciprocal; }
    }
    for (const branch of m.branches) branch.endpoints[id] = 0;
  }
  if (obs.rabbit !== null) {
    const endpoints = new Float64Array(board.size); endpoints[obs.rabbit] = 1;
    m.branches = [{ origin: obs.rabbit, endpoints }];
    m.lastSighting = { cell: obs.rabbit, round: obs.round };
  }
  combine(m, obs);
  // Observing before and after a step is idempotent; visits count actual travel.
  if (m.lastPosition !== obs.fox) {
    if (m.lastPosition >= 0) {
      const direction = board.neighbors[m.lastPosition].indexOf(obs.fox);
      if (direction >= 0) m.traversals[m.lastPosition * 6 + direction]++;
    }
    m.previous = m.lastPosition; m.lastPosition = obs.fox; m.tick++;
    m.visits[obs.fox]++; m.lastVisit[obs.fox] = m.tick;
  }
  return m;
}
function massAt(board, m, id) {
  let mass = 0; for (const cell of board.visibility[id]) mass += m.belief[cell]; return mass;
}
export function hunt(agent, obs) {
  const { board } = obs, m = rememberFox(agent, obs), neighbors = board.neighbors[obs.fox].filter(id => id >= 0);
  if (obs.rabbit !== null) {
    m.goal = { cell: obs.rabbit, mass: 1, reason: 'pursue sighting' };
    const distance = Math.min(...neighbors.map(id => board.distances[id][obs.rabbit]));
    return { type: 'move', to: neighbors.find(id => board.distances[id][obs.rabbit] === distance) };
  }
  const currentMass = m.goal ? massAt(board, m, m.goal.cell) : 0;
  // A destination survives individual steps and turn boundaries until searched
  // or invalidated by evidence. This removes the old step-by-step target churn.
  if (!m.goal || m.goal.cell === obs.fox || currentMass < 1e-6 || currentMass < m.goal.mass * .2) {
    let target = -1, best = -Infinity, targetMass = 0;
    for (let id = 0; id < board.size; id++) {
      if (id === obs.fox) continue;
      const mass = massAt(board, m, id); if (mass < 1e-8) continue;
      const distance = board.distances[obs.fox][id], age = obs.round - m.seen[id];
      const recency = .65 + .35 * Math.min(1, age / 3);
      let frontier = 0;
      for (const cell of board.visibility[id]) if (m.known[cell] && m.seen[cell] !== obs.round) frontier++;
      const score = (mass + m.belief[id] * .3) * recency / Math.pow(distance + 1, .8)
        + (agent.policy === 'scout' ? .002 : .001) * frontier / (distance + 1)
        - Math.min(m.visits[id], 10) * .0003;
      if (score > best) { best = score; target = id; targetMass = mass; }
    }
    // Uncertainty never authorizes a pass: explore the least recently checked
    // region if all modeled branches have been ruled out.
    if (target < 0) target = neighbors.slice().sort((a, b) => m.lastVisit[a] - m.lastVisit[b])[0];
    m.goal = { cell: target, mass: targetMass, reason: 'inspect escape branch' }; m.goalChanges++;
  }
  const distance = board.distances[obs.fox][m.goal.cell];
  let best = -Infinity, to = neighbors[0];
  for (const id of neighbors) {
    if (board.distances[id][m.goal.cell] >= distance) continue;
    const direction = board.neighbors[obs.fox].indexOf(id);
    const score = massAt(board, m, id) * 5 - Math.max(0, 6 - (m.tick - m.lastVisit[id])) * .03
      - m.visits[id] * .002 - m.traversals[obs.fox * 6 + direction] * .004;
    if (score > best) { best = score; to = id; }
  }
  return { type: 'move', to };
}
